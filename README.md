# VoxPage — AI Voice Reader for the Web

VoxPage is a Chrome extension (Manifest V3) that **reads any web page aloud** using AI and lets you **chat with the page** through natural voice personas. It extracts the meaningful content of a page, summarizes it with an AI model, and speaks it back to you with high-quality text-to-speech — hands-free, even after you close the popup.

It is backed by a secure Node.js + PostgreSQL API that handles accounts, email verification, and free/premium plans.

---

## Features

- **Read any page aloud** — smart content extraction (article/headings) that skips menus, nav, and clutter.
- **Chat with the page** — ask questions and get spoken answers grounded in the page content.
- **Voice personas ("AI Readers")** — each persona is a voice + personality (e.g. *Aiko* cheerful/free, *Ren* calm/premium). Your choice is remembered.
- **Persistent playback** — a floating overlay keeps reading even when the popup is closed.
- **Accounts & plans** — register, email verification, login, password reset, and free/premium gating.
- **Admin dashboard** — a separate web console (served at `/admin`) to manage users, ban/unban accounts, change plans, manage the reader catalog, and edit backend `.env` settings. Admins are provisioned from the server config, never through the extension.

---

## Architecture

```
Popup UI        → User interaction & audio controls
Content Script  → DOM reading + in-page audio overlay (untrusted zone)
Background SW   → AI, TTS, auth, readers, orchestration (trusted zone)
Backend API     → Auth, accounts, plans, admin (Express + PostgreSQL)
Admin Dashboard → Static web console served at /admin (admin-only API)
External APIs   → Google Gemini (text) · ElevenLabs (voice)
```

**Design patterns:** Facade (background orchestrator) · Observer (event-driven messaging) · Command (message handlers) · Strategy (swappable reader personas).

**Security model (zero-trust):**

```
[ Untrusted Input ]  → validate everything
[ Message Boundary ] → explicit sender allowlist
[ Trusted Core ]     → background / storage
[ Minimal Privileged APIs ]
```

---

## Project structure

```
extension/
├─ popup/         # UI (html, css, js, i18n.js)
├─ background/    # background.js (Facade) + services
│  ├─ commands/     # Command registry (Map<MessageType, command>)
│  └─ strategies/   # ReaderStrategy + PlanStrategy
├─ content/       # content.js — DOM extraction + audio overlay
├─ assets/readers/ # bundled SVG reader avatars
├─ shared/        # contracts.js (message schemas + validation) + storage.js
└─ manifest.json
backend/
├─ server.js          # Express API (auth, AI/TTS proxy, plans, linking, admin)
├─ plan.strategy.js   # server-side plan limits (authoritative)
├─ env.manager.js     # parse/update backend/.env for the admin Settings panel
├─ public/admin/      # admin dashboard web console (index.html, dashboard.js, admin.css)
├─ database/
│  ├─ schema.sql                    # full schema (users, readers, usage…)
│  ├─ migration_admin_readers.sql   # idempotent migration for existing DBs
│  └─ run-sql.js                    # apply a .sql file without psql installed
├─ .env.example       # committed template
└─ .env               # (NOT committed — see setup)
tests/
├─ unit_test.js
└─ integration_test.js
```

---

## Tech stack

| Layer     | Tech |
|-----------|------|
| Extension | JavaScript (ES Modules), Chrome Manifest V3 |
| AI        | Google Gemini |
| Voice     | ElevenLabs TTS |
| Backend   | Node.js, Express, PostgreSQL |
| Auth      | JWT, bcryptjs, email verification (nodemailer), rate limiting |

---

## Getting started

### 1. Backend

```bash
npm install
```

Create `backend/.env` (see `backend/.env.example` for the full template):

```env
PORT=3000
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=voxpage
JWT_SECRET=change_me_to_a_long_random_string
EMAIL_USER=your_gmail_address
EMAIL_PASS=your_gmail_app_password
TEST_MODE=true   # logs codes to console instead of sending email

# Admin account — provisioned automatically on server startup (the ONLY way to
# create an admin; the extension registration panel always creates regular users).
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_me_to_a_strong_password

# AI / TTS provider keys (server-side only — never shipped to the client)
GEMINI_API_KEY=your_gemini_key
ELEVENLABS_API_KEY=your_elevenlabs_key

# Extension origin allowlist for CORS, and Google OAuth client id (optional)
ALLOWED_ORIGIN=chrome-extension://<EXTENSION_ID>
GOOGLE_CLIENT_ID=
```

Initialize the database, then start the server:

```bash
# Fresh database — full schema (includes users, readers, admin flags):
psql -d voxpage -f backend/database/schema.sql

# Existing database — apply the idempotent admin/readers migration instead.
# No psql? Use the bundled runner (reads backend/.env for the connection):
node backend/database/run-sql.js backend/database/migration_admin_readers.sql

npm run start:server
```

On startup the server provisions the admin account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`
and loads the reader catalog from the database (log: `👑 Admin account ready: …`).

### 2. API keys

Provide your own keys in **`backend/.env` only** — they are never shipped to the client:

- **Google Gemini** → `GEMINI_API_KEY` (used by the backend `/ai/*` proxy)
- **ElevenLabs** → `ELEVENLABS_API_KEY` (used by the backend `/tts/speak` proxy)

The extension calls the backend with the user's JWT; the backend calls Gemini/ElevenLabs. No provider keys exist in the extension source.

### 3. Load the extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder

---

## Admin dashboard

A standalone web console for operators, served by the backend at **`http://localhost:3000/admin`**.
It is separate from the extension — the extension stays user-only.

**Access:** an admin is any user with `is_admin = TRUE` in the database. You never register an
admin; the server creates/updates one from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env` on
every startup (idempotent — verified, premium, un-bannable). Log in at `/admin` with those
credentials; non-admin accounts are rejected.

**What it does:**

- **Users** — list every account with plan, status, and today's read count; change a user's plan;
  **ban / unban** (a ban blocks new logins *and* rejects existing tokens on all protected routes).
  Admin accounts are protected from being banned.
- **Readers** — full CRUD over the AI reader catalog (name, slug, description, personality prompt,
  required plan, ElevenLabs voice id, avatar, enabled). Readers now live in the `readers` DB table
  instead of being hardcoded; the extension fetches them from `GET /readers` and caches them.
- **Settings (.env)** — view and edit backend environment variables grouped by section. Secrets are
  masked with a reveal toggle, comments/formatting are preserved on save, and high-risk keys
  (`DB_*`, `JWT_SECRET`, `PORT`, `ADMIN_*`) are flagged with a confirm step. Most changes require a
  server restart to take effect.

> ⚠️ The Settings panel exposes secrets to anyone holding an admin token. Keep the backend behind
> HTTPS and a locked-down `ALLOWED_ORIGIN` before exposing it beyond localhost.

**Admin API** (all behind an admin-only JWT check): `GET /admin/users`, `GET /admin/stats`,
`POST /admin/users/:id/ban` · `/unban` · `/plan`, `GET/POST/PUT/DELETE /admin/readers`,
`GET/PUT /admin/env`.

---

## Security notes

- Sender validation on every message (`sender.id === chrome.runtime.id`).
- Passwords hashed with bcrypt; email/reset codes stored hashed; JWT sessions.
- Auth rate limiting and transactional DB writes.
- Provider keys live only in `backend/.env`; AI/TTS calls are proxied (no keys in the client).
- Zero-trust message validation (every message checked against a schema, fail closed).
- CORS locked to the extension origin; per-plan limits enforced server-side.
- Least-privilege permissions (`storage`, `activeTab`, `scripting`, `identity`) + a strict CSP.

**Before publishing:** never commit `.env`, API keys, or credentials — the whitelist `.gitignore` pushes only the README, source, and `*.env.example`.

---

## Testing

```bash
npm test            # unit tests always run; integration runs if the backend is up
```

- **Unit tests** (`tests/unit_test.js`) cover the Reader/Plan strategies and message validation.
- **Integration tests** (`tests/integration_test.js`) hit the backend (start it in `TEST_MODE`); they are skipped gracefully when no server is reachable.

---

## Roadmap

- Streaming TTS playback
- More voice personas
- In-page selection-to-speech

---

## Chrome Web Store Listing

**Short description (max 132 chars):**

> Read any web page aloud with AI voices and chat with the page. Pick a voice persona, ask questions, and listen hands-free.

**Detailed description:**

> VoxPage turns any web page into a hands-free listening experience. It extracts the meaningful content of a page, summarizes it with AI, and reads it aloud in a natural voice — and keeps playing even after you close the popup.
>
> - Read any page aloud — smart extraction skips menus, nav, and clutter.
> - Chat with the page — ask questions and get spoken answers grounded in the content.
> - Voice personas — choose a reader (voice + personality); your choice is remembered.
> - Voice input — ask by microphone, not just typing.
> - Multi-language UI — English, Français, العربية (RTL).
> - Accounts & plans — secure sign-in with free and premium tiers.
>
> Your provider keys never leave the server: the extension talks to a secure backend that proxies AI and text-to-speech.

**Permission justifications:**

| Permission | Why |
|------------|-----|
| `storage`    | Save your session, selected reader, language, and conversation history. |
| `activeTab`  | Read the content of the page you choose to listen to. |
| `scripting`  | Inject the in-page audio overlay so playback continues with the popup closed. |
| `identity`   | Optional Google account linking. |

---

## License

ISC
