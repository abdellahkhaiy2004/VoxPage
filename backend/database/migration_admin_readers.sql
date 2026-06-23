-- Idempotent migration for the admin system + DB-backed readers.
-- Run this ONCE against an existing VoxPage database:
--   psql "$DATABASE_URL" -f backend/database/migration_admin_readers.sql
-- (Fresh installs get everything from schema.sql and don't need this file.)

-- 1. Admin + ban flags on users -------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned   BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Readers table --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    personality_prompt TEXT NOT NULL DEFAULT '',
    required_plan TEXT NOT NULL DEFAULT 'free',
    elevenlabs_voice_id TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (required_plan IN ('free', 'premium'))
);

-- update_updated_at() already exists from schema.sql; (re)attach the trigger safely.
DROP TRIGGER IF EXISTS trg_readers_updated ON readers;
CREATE TRIGGER trg_readers_updated
BEFORE UPDATE ON readers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- 3. Seed the original 6 readers (no-op if a slug already exists) ----------------
INSERT INTO readers (slug, name, description, personality_prompt, required_plan, elevenlabs_voice_id, avatar) VALUES
('aiko', 'Aiko', 'Cheerful and friendly — reads in a warm, upbeat tone.', 'You are Aiko, a cheerful narrator. Read the following text in a friendly, engaging way. Keep it natural and conversational.', 'free', '9BWtsMINqrJLrRacOk9x', 'assets/readers/aiko.svg'),
('mira', 'Mira', 'Gentle storyteller — soothing and great for long reads.', 'You are Mira, a gentle storyteller. Read the text in a soft, soothing, expressive voice as if telling a story.', 'free', 'EXAVITQu4vr4xnSDxMaL', 'assets/readers/mira.svg'),
('kai', 'Kai', 'Energetic and bold — keeps the pace lively.', 'You are Kai, an energetic narrator. Read the text with enthusiasm and a lively, upbeat pace.', 'free', 'bIHbv24MWmeRgasZH58o', 'assets/readers/kai.svg'),
('ren', 'Ren', 'Calm and cool — steady, composed delivery.', 'You are Ren, a calm and cool narrator. Read the following text in a steady, deep, and composed manner.', 'premium', 'nPczCjzI2devNBz1zQrb', 'assets/readers/ren.svg'),
('nova', 'Nova', 'Crisp and modern — clear, precise narration.', 'You are Nova, a crisp modern narrator. Read the text clearly and precisely with a confident, professional tone.', 'premium', 'cgSgspJ2msm6clMCkdW9', 'assets/readers/nova.svg'),
('sage', 'Sage', 'Wise and measured — a thoughtful documentary feel.', 'You are Sage, a wise and measured narrator. Read the text thoughtfully with a calm, documentary-style tone.', 'premium', 'JBFqnCBsd6RMkjVDRZzb', 'assets/readers/sage.svg')
ON CONFLICT (slug) DO NOTHING;

-- 4. Promote your admin account (edit the email, then it's done):
-- UPDATE users SET is_admin = TRUE WHERE email = 'operator@example.com';
