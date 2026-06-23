import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPlanStrategy } from './plan.strategy.js';
import { readEnvSections, writeEnvUpdates } from './env.manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');

dotenv.config({ path: 'backend/.env' });

const app = express();
const port = process.env.PORT || 3000;
const TEST_MODE = process.env.TEST_MODE === 'true';

// Provider keys (server-side only — never expose to the client)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// --- SECURITY MIDDLEWARE ---

// 7. Restrict CORS. Lock to ALLOWED_ORIGIN when it is set to a real value;
//    otherwise fall back to '*' for local development (with a warning).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const corsOrigin = (ALLOWED_ORIGIN && !ALLOWED_ORIGIN.includes('<')) ? ALLOWED_ORIGIN : '*';
if (corsOrigin === '*') {
    console.warn('⚠️  CORS open to all origins. Set ALLOWED_ORIGIN in .env to lock down.');
}
app.use(cors({
    origin: corsOrigin,
    methods: ['GET', 'POST']
}));

app.use(express.json());

// Serve the admin dashboard (static web app) at /admin.
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// 5. Rate Limiting (Brute-force protection)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 auth requests per window
    message: { success: false, error: 'Too many requests, please try again later.' }
});
app.use('/auth/', authLimiter);

// Rate limiting for AI/TTS proxy endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 60, // 60 AI/TTS requests per IP per window
    message: { success: false, error: 'Too many requests, please slow down.' }
});
app.use(['/ai/', '/tts/'], apiLimiter);

// --- DATABASE CONNECTION ---
const { Pool } = pg;
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

pool.connect()
    .then(() => console.log('✅ Connected to PostgreSQL Database'))
    .catch(err => console.error('❌ Database connection error:', err.message));

// --- EMAIL TRANSPORTER ---
let transporter = null;
if (!TEST_MODE) {
    if (!process.env.EMAIL_PASS || process.env.EMAIL_PASS === 'your_app_password') {
        console.warn('⚠️  EMAIL_PASS not configured. Emails will fail.');
    } else {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }
}

// --- HELPERS ---

function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// --- CLEANUP EXPIRED UNVERIFIED USERS ---
// Deletes users who never verified and whose verification code has expired
async function cleanupExpiredUnverifiedUsers() {
    try {
        // Delete unverified users whose verification tokens have expired
        // This uses CASCADE from the schema to also delete related passwords and tokens
        const result = await pool.query(`
            DELETE FROM users 
            WHERE email_verified = FALSE 
            AND id IN (
                SELECT user_id FROM email_verification_tokens 
                WHERE expires_at < NOW()
            )
        `);

        if (result.rowCount > 0) {
            console.log(`[Cleanup] Deleted ${result.rowCount} expired unverified user(s)`);
        }
    } catch (error) {
        console.error('[Cleanup] Error cleaning expired users:', error.message);
    }
}

// Cleanup for a specific email (called before registration check)
async function cleanupExpiredUserByEmail(email) {
    try {
        const result = await pool.query(`
            DELETE FROM users 
            WHERE email = $1 
            AND email_verified = FALSE 
            AND id IN (
                SELECT user_id FROM email_verification_tokens 
                WHERE expires_at < NOW()
            )
        `, [email]);

        if (result.rowCount > 0) {
            console.log(`[Cleanup] Deleted expired unverified user: ${email}`);
        }
        return result.rowCount > 0;
    } catch (error) {
        console.error('[Cleanup] Error cleaning user by email:', error.message);
        return false;
    }
}

async function sendVerificationEmail(email, code) {
    if (TEST_MODE) {
        console.log(`[TEST MODE] Code for ${email}: ${code}`);
        return;
    }
    if (!transporter) throw new Error('Email server not configured');

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Verify your AI Reader Account',
        text: `Your verification code is: ${code}`,
        html: `<h3>Your Verification Code</h3><h1>${code}</h1><p>Expires in 15 minutes.</p>`
    });
    console.log(`[Email] Sent to ${email}`);
}

// --- ADMIN BOOTSTRAP ---
// Provisions the admin account from .env (ADMIN_EMAIL / ADMIN_PASSWORD) on startup.
// This is the ONLY supported way to create an admin — the extension's registration
// panel always creates regular, non-admin users. Idempotent: safe on every boot.
// On each boot it (re)asserts is_admin=TRUE, clears any ban, marks the email verified,
// and syncs the password to match .env (so rotating ADMIN_PASSWORD just works).
async function ensureAdminUser() {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!email || !password) {
        console.warn('⚠️  ADMIN_EMAIL/ADMIN_PASSWORD not set in .env — no admin account provisioned.');
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        let userId;
        if (existing.rows.length > 0) {
            userId = existing.rows[0].id;
            await client.query(
                'UPDATE users SET is_admin = TRUE, banned = FALSE, email_verified = TRUE WHERE id = $1',
                [userId]
            );
        } else {
            const ins = await client.query(
                `INSERT INTO users (email, email_verified, plan, is_admin, banned)
                 VALUES ($1, TRUE, 'premium', TRUE, FALSE) RETURNING id`,
                [email]
            );
            userId = ins.rows[0].id;
        }
        const passwordHash = await bcrypt.hash(password, 12);
        await client.query(
            `INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
            [userId, passwordHash]
        );
        await client.query('COMMIT');
        console.log(`👑 Admin account ready: ${email}`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[AdminBootstrap] Could not provision admin:', e.message);
    } finally {
        client.release();
    }
}

// 4. JWT Helper
function generateToken(user) {
    return jwt.sign(
        { id: user.id, plan: user.plan, email_verified: user.email_verified, is_admin: user.is_admin || false },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
}

// Step 3: JWT auth middleware — protects the AI/TTS proxy routes.
// Also enforces bans: a banned account is rejected even with a still-valid token.
async function authRequired(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ success: false, error: 'Missing token' });
    }
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    try {
        const u = await pool.query('SELECT banned, is_admin FROM users WHERE id = $1', [req.user.id]);
        if (u.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Account no longer exists' });
        }
        if (u.rows[0].banned) {
            return res.status(403).json({ success: false, error: 'Account banned' });
        }
        // Trust the DB over the (possibly stale) token for admin status.
        req.user.is_admin = u.rows[0].is_admin;
        next();
    } catch (e) {
        console.error('[authRequired]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
}

// Admin-only middleware — chains on authRequired, then requires is_admin.
function adminRequired(req, res, next) {
    authRequired(req, res, () => {
        if (!req.user || !req.user.is_admin) {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }
        next();
    });
}

// --- PLAN / USAGE HELPERS ---

// Authoritative plan from the DB (the JWT copy can be stale after an upgrade).
async function getUserPlan(userId) {
    const r = await pool.query('SELECT plan FROM users WHERE id = $1', [userId]);
    return r.rows[0]?.plan || 'free';
}

async function getTodayReads(userId) {
    const r = await pool.query(
        'SELECT reads FROM usage_counters WHERE user_id = $1 AND usage_date = CURRENT_DATE',
        [userId]
    );
    return r.rows[0]?.reads || 0;
}

async function incrementTodayReads(userId) {
    await pool.query(
        `INSERT INTO usage_counters (user_id, usage_date, reads)
         VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (user_id, usage_date)
         DO UPDATE SET reads = usage_counters.reads + 1`,
        [userId]
    );
}

// --- AI/TTS PROVIDER HELPERS (server-side) ---

// Default to a current model; older models (gemini-pro, gemini-1.5-*) are retired.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';

// Generation "capabilities" — all configurable via .env (sensible defaults kept).
const GEMINI_TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE ?? '0.7');
const GEMINI_MAX_OUTPUT_TOKENS = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? '400', 10);
const GEMINI_TOP_P = process.env.GEMINI_TOP_P !== undefined ? parseFloat(process.env.GEMINI_TOP_P) : undefined;
const GEMINI_TOP_K = process.env.GEMINI_TOP_K !== undefined ? parseInt(process.env.GEMINI_TOP_K, 10) : undefined;

// Build a generationConfig from env defaults, allowing per-call overrides.
function geminiConfig(overrides = {}) {
    const cfg = {
        temperature: GEMINI_TEMPERATURE,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS
    };
    if (GEMINI_TOP_P !== undefined && !Number.isNaN(GEMINI_TOP_P)) cfg.topP = GEMINI_TOP_P;
    if (GEMINI_TOP_K !== undefined && !Number.isNaN(GEMINI_TOP_K)) cfg.topK = GEMINI_TOP_K;
    return { ...cfg, ...overrides };
}

async function callGemini(prompt, generationConfig) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
    const url = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig })
    });
    if (!r.ok) {
        const errText = await r.text();
        throw new Error(`Gemini ${r.status}: ${errText.substring(0, 200)}`);
    }
    const j = await r.json();
    const out = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out) throw new Error('Empty AI response');
    return out;
}

// ElevenLabs voice map. Free API accounts can only use ElevenLabs' CURRENT default
// voices (Aria, Sarah, etc.) — NOT Voice Library / community voices, and NOT the old
// deprecated defaults (Rachel/Arnold...). Each reader gets a distinct current default
// voice; override any via .env. If a configured voice is blocked, the route falls
// back to ELEVENLABS_FALLBACK_VOICE so the user still hears audio.
const ELEVENLABS_FALLBACK_VOICE = process.env.ELEVENLABS_FALLBACK_VOICE || '9BWtsMINqrJLrRacOk9x'; // Aria
const DEFAULT_VOICE = process.env.ELEVENLABS_DEFAULT_VOICE || '9BWtsMINqrJLrRacOk9x'; // Aria (current default)
const VOICE_MAP = {
    aiko: process.env.ELEVENLABS_VOICE_AIKO || '9BWtsMINqrJLrRacOk9x', // Aria
    mira: process.env.ELEVENLABS_VOICE_MIRA || 'EXAVITQu4vr4xnSDxMaL', // Sarah
    kai: process.env.ELEVENLABS_VOICE_KAI || 'bIHbv24MWmeRgasZH58o',   // Will
    ren: process.env.ELEVENLABS_VOICE_REN || 'nPczCjzI2devNBz1zQrb',   // Brian
    nova: process.env.ELEVENLABS_VOICE_NOVA || 'cgSgspJ2msm6clMCkdW9', // Jessica
    sage: process.env.ELEVENLABS_VOICE_SAGE || 'JBFqnCBsd6RMkjVDRZzb', // George
    default: DEFAULT_VOICE
};

// --- READER CATALOG (DB-backed) ---
// Readers now live in the `readers` table and are managed from the admin dashboard.
// We keep an in-memory cache (refreshed at startup and after admin edits) so the
// hot TTS path doesn't hit the DB every call. The hardcoded VOICE_MAP above is the
// fallback if the readers table is missing/empty (e.g. migration not run yet).
let READERS_CACHE = [];

async function loadReaders() {
    try {
        const r = await pool.query(
            'SELECT slug, name, description, personality_prompt, required_plan, elevenlabs_voice_id, avatar FROM readers WHERE enabled = TRUE ORDER BY created_at ASC'
        );
        READERS_CACHE = r.rows;
        console.log(`🔊 Loaded ${r.rows.length} reader(s) from DB`);
    } catch (e) {
        console.warn('[Readers] Could not load from DB, falling back to built-in VOICE_MAP:', e.message);
        READERS_CACHE = [];
    }
}

// Resolve a reader slug to an actual ElevenLabs voice id (DB first, then env/VOICE_MAP).
function resolveVoiceId(slug) {
    const reader = READERS_CACHE.find(x => x.slug === slug);
    if (reader && reader.elevenlabs_voice_id) return reader.elevenlabs_voice_id;
    return VOICE_MAP[slug] || VOICE_MAP.default;
}

// The plan a given reader requires. Unknown slugs default to 'free'.
function readerRequiredPlan(slug) {
    const reader = READERS_CACHE.find(x => x.slug === slug);
    if (reader) return reader.required_plan;
    // Fallback for the legacy hardcoded premium voices when DB cache is empty.
    return ['ren', 'nova', 'sage'].includes(slug) ? 'premium' : 'free';
}

// Whether a user on `plan` may use the reader `slug`.
function isReaderAllowed(plan, slug) {
    if (plan === 'premium') return true;
    return readerRequiredPlan(slug) === 'free';
}

// Shape a DB reader row into the object the extension expects (legacy Readers shape).
function readerToClient(row) {
    return {
        id: row.slug,
        name: row.name,
        voiceId: row.slug,
        avatar: row.avatar,
        description: row.description,
        personalityPrompt: row.personality_prompt,
        requiredPlan: row.required_plan
    };
}

// Single ElevenLabs TTS call for a given voice. Returns the raw fetch Response.
async function elevenLabsTTS(text, voiceId) {
    return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
            text,
            model_id: process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
    });
}

// --- ROUTES ---

// 1. REGISTER (Transactional, Bcrypt, Hashed Tokens)
app.post('/auth/register', async (req, res) => {
    const client = await pool.connect();
    try {
        const { email, password } = req.body;

        // 11. Generic Error Message (Prepare)
        const GENERIC_ERROR = 'Registration failed. Please check your details.';

        // Clean up expired unverified user for this email (if any)
        await cleanupExpiredUserByEmail(email);

        await client.query('BEGIN'); // 10. Start Transaction

        // Check availability
        const check = await client.query('SELECT id, email_verified FROM users WHERE email = $1', [email]);
        let userId;

        if (check.rows.length > 0) {
            const existing = check.rows[0];
            if (existing.email_verified) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'User already exists' });
            }
            userId = existing.id;
            // Cleaning up old unverified data? We'll overwrite password/token below.
        } else {
            // Insert User
            const uRes = await client.query(
                `INSERT INTO users (email, email_verified, plan) 
                 VALUES ($1, FALSE, 'free') RETURNING id`,
                [email]
            );
            userId = uRes.rows[0].id;
        }

        // 1. Hash Password (bcrypt)
        const passwordHash = await bcrypt.hash(password, 12);

        // Upsert Password (delete old if exists to be safe, or just insert)
        await client.query('DELETE FROM user_passwords WHERE user_id = $1', [userId]);
        await client.query(
            'INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)',
            [userId, passwordHash]
        );

        // 2 & 3. Generate & Hash Verification Code
        const code = generateCode();
        const codeHash = await bcrypt.hash(code, 10); // Hash the 6-digit code

        await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
        await client.query(
            `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) 
             VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
            [userId, codeHash]
        );

        await client.query('COMMIT'); // Commit Transaction

        // Attempt Email (Non-blocking for the transaction, but we wait for response to user)
        // In prod, use a queue. Here we await.
        await sendVerificationEmail(email, code);

        res.json({ success: true, message: 'Verification code sent.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Register Error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    } finally {
        client.release();
    }
});

// 1.5 RESEND CODE (Rate Limited, Hashed)
app.post('/auth/resend', async (req, res) => {
    const client = await pool.connect();
    try {
        const { email } = req.body;

        await client.query('BEGIN');

        // Check user
        const check = await client.query('SELECT id, email_verified FROM users WHERE email = $1', [email]);
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'User not found' });
        }

        const user = check.rows[0];
        if (user.email_verified) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'User already verified' });
        }

        // Generate and Hash Code
        const code = generateCode();
        const codeHash = await bcrypt.hash(code, 10);

        await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);
        await client.query(
            `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) 
             VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
            [user.id, codeHash]
        );

        await client.query('COMMIT');

        // Send Email
        await sendVerificationEmail(email, code);

        res.json({ success: true, message: 'Verification code sent' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Resend error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    } finally {
        client.release();
    }
});

// 2. VERIFY (Compare Hash, Secure)
app.post('/auth/verify', async (req, res) => {
    const { email, code } = req.body; // Ideally use a tmp token, but email+code with rate limit is acceptable for MVP

    // 5. Rate limiting applied globally to /auth/ already

    if (!email || !code) return res.status(400).json({ success: false, error: 'Missing credentials' });

    try {
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(400).json({ success: false, error: 'Invalid request' });

        const userId = userRes.rows[0].id;

        // Fetch Token Hash
        const tokenRes = await pool.query(
            `SELECT token_hash FROM email_verification_tokens 
             WHERE user_id = $1 AND expires_at > NOW()`,
            [userId]
        );

        if (tokenRes.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid or expired code' });
        }

        // Compare Code with Hash
        const valid = await bcrypt.compare(code, tokenRes.rows[0].token_hash);
        if (!valid) {
            return res.status(400).json({ success: false, error: 'Invalid code' });
        }

        // Success
        await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
        await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);

        res.json({ success: true });

    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// 3. LOGIN (Bcrypt Compare, Issue JWT)
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query(
            `SELECT u.id, u.email, u.email_verified, u.plan, u.is_admin, u.banned, p.password_hash
             FROM users u
             JOIN user_passwords p ON u.id = p.user_id
             WHERE u.email = $1`,
            [email]
        );

        // 11. Generic Error
        const AUTH_FAIL = 'Invalid email or password';

        if (result.rows.length === 0) return res.status(401).json({ success: false, error: AUTH_FAIL });
        const user = result.rows[0];

        // Compare Password
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ success: false, error: AUTH_FAIL });

        if (user.banned) {
            return res.status(403).json({ success: false, error: 'This account has been banned.' });
        }

        if (!user.email_verified) {
            return res.json({ success: false, error: 'Email not verified', requiresVerification: true });
        }

        // 4. Issue Real JWT
        const token = generateToken(user);

        res.json({ success: true, plan: user.plan, token, is_admin: user.is_admin || false });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// 4. FORGOT PASSWORD - Send Reset Code
app.post('/auth/forgot-password', async (req, res) => {
    const client = await pool.connect();
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        await client.query('BEGIN');

        // Check if user exists and is verified
        const check = await client.query(
            'SELECT id, email_verified FROM users WHERE email = $1',
            [email]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Email not found' });
        }

        const user = check.rows[0];
        if (!user.email_verified) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Email not verified. Please register first.' });
        }

        // Generate and hash reset code
        const code = generateCode();
        const codeHash = await bcrypt.hash(code, 10);

        // Store in email_verification_tokens (reusing table for reset codes)
        await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);
        await client.query(
            `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) 
             VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
            [user.id, codeHash]
        );

        await client.query('COMMIT');

        // Send reset code email
        await sendVerificationEmail(email, code);

        res.json({ success: true, message: 'Reset code sent to email' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    } finally {
        client.release();
    }
});

// 5. RESET PASSWORD - Verify Code and Update Password
app.post('/auth/reset-password', async (req, res) => {
    const client = await pool.connect();
    try {
        const { email, code, newPassword } = req.body;

        if (!email || !code || !newPassword) {
            return res.status(400).json({ success: false, error: 'All fields are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }

        await client.query('BEGIN');

        // Get user
        const userRes = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Invalid request' });
        }

        const userId = userRes.rows[0].id;

        // Verify reset code
        const tokenRes = await client.query(
            `SELECT token_hash FROM email_verification_tokens 
             WHERE user_id = $1 AND expires_at > NOW()`,
            [userId]
        );

        if (tokenRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Invalid or expired code' });
        }

        const valid = await bcrypt.compare(code, tokenRes.rows[0].token_hash);
        if (!valid) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Invalid code' });
        }

        // Update password
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await client.query(
            'UPDATE user_passwords SET password_hash = $1 WHERE user_id = $2',
            [passwordHash, userId]
        );

        // Delete used token
        await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);

        await client.query('COMMIT');

        res.json({ success: true, message: 'Password reset successful' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    } finally {
        client.release();
    }
});

// --- GOOGLE ACCOUNT LINKING (JWT-protected) ---

// Step 22: verify a Google access token with Google, then link the account.
app.post('/auth/link-google', authRequired, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ success: false, error: 'Missing Google token' });
        }

        // Verify the token with Google and read the account id (sub).
        const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
        if (!r.ok) {
            return res.status(401).json({ success: false, error: 'Invalid Google token' });
        }
        const info = await r.json();

        // If a client id is configured, ensure the token was minted for THIS app.
        const expectedAud = process.env.GOOGLE_CLIENT_ID;
        if (expectedAud && info.aud && info.aud !== expectedAud) {
            return res.status(401).json({ success: false, error: 'Google token audience mismatch' });
        }

        const sub = info.sub;
        if (!sub) {
            return res.status(401).json({ success: false, error: 'Could not read Google account id' });
        }

        // Idempotent link — re-linking the same account is a no-op.
        await pool.query(
            `INSERT INTO auth_providers (user_id, provider, provider_user_id)
             VALUES ($1, 'google', $2)
             ON CONFLICT (provider, provider_user_id) DO NOTHING`,
            [req.user.id, sub]
        );

        return res.json({ success: true, linked: true, email: info.email || null });
    } catch (e) {
        console.error('[LinkGoogle]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Step 22: report which external providers are linked to this account.
app.get('/auth/link-status', authRequired, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT provider FROM auth_providers WHERE user_id = $1',
            [req.user.id]
        );
        const providers = r.rows.map(row => row.provider);
        return res.json({ success: true, google: providers.includes('google') });
    } catch (e) {
        console.error('[LinkStatus]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// --- PLAN ROUTES (JWT-protected) ---

// Step 18: Read the current plan from the DB.
app.get('/plan', authRequired, async (req, res) => {
    try {
        const plan = await getUserPlan(req.user.id);
        return res.json({ success: true, plan });
    } catch (e) {
        console.error('[Plan]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Step 18: Upgrade to premium. Payment is a sandbox stub for now.
app.post('/upgrade', authRequired, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE users SET plan = 'premium' WHERE id = $1 RETURNING plan`,
            [req.user.id]
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.json({ success: true, plan: r.rows[0].plan });
    } catch (e) {
        console.error('[Upgrade]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// --- AI/TTS PROXY ROUTES (JWT-protected) ---

// Step 4: Summarize a web page for reading aloud.
app.post('/ai/summarize', authRequired, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ success: false, error: 'Missing text' });
        }

        // Step 21: enforce the free-plan daily read limit (server-side).
        const strategy = getPlanStrategy(await getUserPlan(req.user.id));
        if (Number.isFinite(strategy.dailyReadLimit)) {
            const used = await getTodayReads(req.user.id);
            if (used >= strategy.dailyReadLimit) {
                return res.status(429).json({
                    success: false,
                    error: `Daily read limit reached (${strategy.dailyReadLimit}). Upgrade to premium for unlimited reads.`
                });
            }
        }

        const prompt = `You are a helpful reader assistant. Your task is to read a webpage and create a CLEAN, NATURAL summary that can be read aloud.

IMPORTANT RULES:
1. Extract ONLY the main article/content from the page
2. IGNORE all navigation menus, table of contents, links, references, footnotes, external links sections
3. IGNORE metadata like "Read", "Edit", "View history", language options, etc.
4. Create a flowing, natural summary of the MAIN CONTENT (2-4 sentences)
5. Speak as if you're explaining the topic to a friend
6. Start with what the page is about

Here is the raw webpage content:
"""
${text.substring(0, 4000)}
"""

Now provide a clean, natural summary for reading aloud:`;

        const data = await callGemini(prompt, geminiConfig());
        await incrementTodayReads(req.user.id); // count a successful read against the quota
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[AI summarize]', e.message);
        return res.status(502).json({ success: false, error: `AI service error: ${e.message}` });
    }
});

// Step 5: Chat about the current page.
app.post('/ai/chat', authRequired, async (req, res) => {
    try {
        const { message, context = '', personalityPrompt = '' } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ success: false, error: 'Missing message' });
        }

        const prompt = `${personalityPrompt}

Context: The user is currently browsing a web page. Here is the relevant text content from that page:
"${String(context).substring(0, 3000)}"

User's Message: "${message}"

Task: Answer the user's message naturally. use the provided page context only if relevant to the user's question.`;

        const data = await callGemini(prompt, geminiConfig());
        return res.json({ success: true, data });
    } catch (e) {
        console.error('[AI chat]', e.message);
        return res.status(502).json({ success: false, error: `AI service error: ${e.message}` });
    }
});

// Step 6: Text-to-speech via ElevenLabs.
app.post('/tts/speak', authRequired, async (req, res) => {
    try {
        const { text, voiceId } = req.body;
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ success: false, error: 'Missing text' });
        }
        if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

        // Step 21: free users may only use free-plan voices (defense in depth).
        // Allowed voices are now derived from the DB-backed reader catalog.
        const plan = await getUserPlan(req.user.id);
        if (voiceId && !isReaderAllowed(plan, voiceId)) {
            return res.status(403).json({
                success: false,
                error: 'This voice requires a premium plan.'
            });
        }

        let elevenVoiceId = resolveVoiceId(voiceId);
        const model = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
        console.log(`[TTS] reader=${voiceId} -> voice=${elevenVoiceId} model=${model}`);

        let r = await elevenLabsTTS(text, elevenVoiceId);

        // Auto-fallback: if the chosen voice is blocked (e.g. a Library voice on a
        // free plan -> 402), retry once with a guaranteed free default voice.
        if (r.status === 402 && elevenVoiceId !== ELEVENLABS_FALLBACK_VOICE) {
            console.warn(`[TTS] voice ${elevenVoiceId} blocked (paid) — falling back to ${ELEVENLABS_FALLBACK_VOICE}`);
            elevenVoiceId = ELEVENLABS_FALLBACK_VOICE;
            r = await elevenLabsTTS(text, elevenVoiceId);
        }

        if (!r.ok) {
            const errText = await r.text();
            throw new Error(`ElevenLabs ${r.status} for voice ${elevenVoiceId}: ${errText.substring(0, 200)}`);
        }

        const buf = Buffer.from(await r.arrayBuffer());
        return res.json({ success: true, audioBase64: buf.toString('base64') });
    } catch (e) {
        console.error('[TTS]', e.message);
        return res.status(502).json({ success: false, error: `TTS service error: ${e.message}` });
    }
});

// --- READER CATALOG ROUTE (JWT-protected, for the extension) ---

// Step 23: the extension fetches its reader catalog from here instead of a
// hardcoded list. Returns only enabled readers in the legacy client shape.
app.get('/readers', authRequired, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT slug, name, description, personality_prompt, required_plan, elevenlabs_voice_id, avatar FROM readers WHERE enabled = TRUE ORDER BY created_at ASC'
        );
        return res.json({ success: true, readers: r.rows.map(readerToClient) });
    } catch (e) {
        console.error('[Readers]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// --- ADMIN ROUTES (admin-only) ---

// Dashboard: list every user with plan, status and today's read count.
app.get('/admin/users', adminRequired, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT u.id, u.email, u.plan, u.is_admin, u.banned, u.email_verified, u.created_at,
                   COALESCE(uc.reads, 0) AS reads_today
            FROM users u
            LEFT JOIN usage_counters uc
                   ON uc.user_id = u.id AND uc.usage_date = CURRENT_DATE
            ORDER BY u.created_at DESC
        `);
        return res.json({ success: true, users: r.rows });
    } catch (e) {
        console.error('[Admin users]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Dashboard summary counters.
app.get('/admin/stats', adminRequired, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT
                COUNT(*)::int                                          AS total_users,
                COUNT(*) FILTER (WHERE plan = 'premium')::int          AS premium_users,
                COUNT(*) FILTER (WHERE banned)::int                    AS banned_users,
                COUNT(*) FILTER (WHERE email_verified)::int            AS verified_users
            FROM users
        `);
        return res.json({ success: true, stats: r.rows[0] });
    } catch (e) {
        console.error('[Admin stats]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Ban a user (cannot ban yourself or another admin).
app.post('/admin/users/:id/ban', adminRequired, async (req, res) => {
    try {
        const { id } = req.params;
        if (id === req.user.id) {
            return res.status(400).json({ success: false, error: 'You cannot ban your own account.' });
        }
        const target = await pool.query('SELECT is_admin FROM users WHERE id = $1', [id]);
        if (target.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        if (target.rows[0].is_admin) {
            return res.status(400).json({ success: false, error: 'Cannot ban an admin account.' });
        }
        await pool.query('UPDATE users SET banned = TRUE WHERE id = $1', [id]);
        return res.json({ success: true, banned: true });
    } catch (e) {
        console.error('[Admin ban]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Unban a user.
app.post('/admin/users/:id/unban', adminRequired, async (req, res) => {
    try {
        const r = await pool.query('UPDATE users SET banned = FALSE WHERE id = $1 RETURNING id', [req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'User not found' });
        return res.json({ success: true, banned: false });
    } catch (e) {
        console.error('[Admin unban]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Change a user's plan.
app.post('/admin/users/:id/plan', adminRequired, async (req, res) => {
    try {
        const { plan } = req.body;
        if (!['free', 'premium'].includes(plan)) {
            return res.status(400).json({ success: false, error: "plan must be 'free' or 'premium'" });
        }
        const r = await pool.query('UPDATE users SET plan = $1 WHERE id = $2 RETURNING plan', [plan, req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'User not found' });
        return res.json({ success: true, plan: r.rows[0].plan });
    } catch (e) {
        console.error('[Admin plan]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// --- ADMIN: READER MANAGEMENT (admin-only) ---

// List all readers (including disabled ones) for the manager UI.
app.get('/admin/readers', adminRequired, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM readers ORDER BY created_at ASC');
        return res.json({ success: true, readers: r.rows });
    } catch (e) {
        console.error('[Admin readers list]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Validate + normalize a reader payload from the admin form.
function parseReaderBody(body) {
    const slug = (body.slug || '').trim().toLowerCase();
    const name = (body.name || '').trim();
    const elevenlabs_voice_id = (body.elevenlabs_voice_id || '').trim();
    if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return { error: 'slug must be lowercase letters/numbers/-/_' };
    if (!name) return { error: 'name is required' };
    if (!elevenlabs_voice_id) return { error: 'elevenlabs_voice_id is required' };
    const required_plan = body.required_plan === 'premium' ? 'premium' : 'free';
    return {
        value: {
            slug,
            name,
            description: (body.description || '').trim(),
            personality_prompt: (body.personality_prompt || '').trim(),
            required_plan,
            elevenlabs_voice_id,
            avatar: (body.avatar || '').trim(),
            enabled: body.enabled === undefined ? true : !!body.enabled
        }
    };
}

// Create a reader.
app.post('/admin/readers', adminRequired, async (req, res) => {
    const { value, error } = parseReaderBody(req.body);
    if (error) return res.status(400).json({ success: false, error });
    try {
        const r = await pool.query(
            `INSERT INTO readers (slug, name, description, personality_prompt, required_plan, elevenlabs_voice_id, avatar, enabled)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [value.slug, value.name, value.description, value.personality_prompt, value.required_plan, value.elevenlabs_voice_id, value.avatar, value.enabled]
        );
        await loadReaders(); // refresh cache so TTS/readers reflect the change immediately
        return res.json({ success: true, reader: r.rows[0] });
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ success: false, error: 'A reader with that slug already exists.' });
        console.error('[Admin reader create]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Update a reader.
app.put('/admin/readers/:id', adminRequired, async (req, res) => {
    const { value, error } = parseReaderBody(req.body);
    if (error) return res.status(400).json({ success: false, error });
    try {
        const r = await pool.query(
            `UPDATE readers SET slug=$1, name=$2, description=$3, personality_prompt=$4,
                    required_plan=$5, elevenlabs_voice_id=$6, avatar=$7, enabled=$8
             WHERE id=$9 RETURNING *`,
            [value.slug, value.name, value.description, value.personality_prompt, value.required_plan, value.elevenlabs_voice_id, value.avatar, value.enabled, req.params.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Reader not found' });
        await loadReaders();
        return res.json({ success: true, reader: r.rows[0] });
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ success: false, error: 'A reader with that slug already exists.' });
        console.error('[Admin reader update]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Delete a reader.
app.delete('/admin/readers/:id', adminRequired, async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM readers WHERE id = $1 RETURNING id', [req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Reader not found' });
        await loadReaders();
        return res.json({ success: true });
    } catch (e) {
        console.error('[Admin reader delete]', e.message);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// --- ADMIN: .ENV SETTINGS (admin-only) ---

// Read all backend env variables, grouped into sections for the Settings UI.
app.get('/admin/env', adminRequired, async (req, res) => {
    try {
        const sections = readEnvSections(ENV_PATH);
        return res.json({ success: true, sections });
    } catch (e) {
        console.error('[Admin env read]', e.message);
        return res.status(500).json({ success: false, error: 'Could not read .env file' });
    }
});

// Save edited/added env values back to backend/.env (comments preserved).
// Most variables only take full effect after a server restart.
app.put('/admin/env', adminRequired, async (req, res) => {
    try {
        const { updates } = req.body || {};
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            return res.status(400).json({ success: false, error: 'Body must be { updates: { KEY: value } }' });
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No changes provided' });
        }
        const changed = writeEnvUpdates(ENV_PATH, updates);
        // Note: never log values — they may be secrets.
        console.log(`[Admin env] ${req.user.id} updated ${changed.length} variable(s): ${changed.join(', ')}`);
        return res.json({ success: true, changed, restartRequired: true });
    } catch (e) {
        console.error('[Admin env write]', e.message);
        return res.status(400).json({ success: false, error: e.message || 'Could not write .env file' });
    }
});

app.listen(port, async () => {
    console.log(`🚀 Secure Server running on port ${port}`);
    if (TEST_MODE) console.log('⚠️  TEST MODE ENABLED');

    // Show the effective config so it's obvious whether .env was picked up.
    const freeLimit = getPlanStrategy('free').dailyReadLimit;
    console.log(`⚙️  Gemini model: ${GEMINI_MODEL}`);
    console.log(`⚙️  Free daily read limit: ${Number.isFinite(freeLimit) ? freeLimit : 'unlimited'}`);
    console.log(`⚙️  ElevenLabs: key=${process.env.ELEVENLABS_API_KEY ? 'set' : 'MISSING'} model=${process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5'} voice=${DEFAULT_VOICE}`);

    // Load the reader catalog into memory (falls back to VOICE_MAP if unavailable).
    await loadReaders();

    // Provision the admin account from .env (ADMIN_EMAIL / ADMIN_PASSWORD).
    await ensureAdminUser();

    // Run cleanup on startup
    await cleanupExpiredUnverifiedUsers();

    // Run cleanup every 5 minutes
    setInterval(cleanupExpiredUnverifiedUsers, 5 * 60 * 1000);
    console.log('🧹 Expired user cleanup job scheduled (every 5 minutes)');
});
