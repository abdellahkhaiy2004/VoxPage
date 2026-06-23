CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    plan TEXT NOT NULL DEFAULT 'free',
    -- Admin flag. Set MANUALLY in the database only — never via the extension's
    -- registration panel (that path always creates regular users).
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    -- Banned users cannot log in and existing tokens are rejected on all routes.
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (plan IN ('free', 'premium'))
);

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE user_passwords (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL
);

CREATE TABLE auth_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,              -- 'google'
    provider_user_id TEXT NOT NULL,      -- Google sub
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

-- Per-user daily usage counters (used to enforce free-plan read limits).
CREATE TABLE usage_counters (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reads INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, usage_date)
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- AI reader catalog (was previously hardcoded in the extension). Admins manage
-- these from the admin dashboard. `slug` is the stable id sent by the client as
-- `voiceId`; `elevenlabs_voice_id` is the real ElevenLabs voice it maps to.
CREATE TABLE readers (
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

CREATE TRIGGER trg_readers_updated
BEFORE UPDATE ON readers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Seed the original 6 readers (slug/voice ids match the legacy VOICE_MAP defaults).
INSERT INTO readers (slug, name, description, personality_prompt, required_plan, elevenlabs_voice_id, avatar) VALUES
('aiko', 'Aiko', 'Cheerful and friendly — reads in a warm, upbeat tone.', 'You are Aiko, a cheerful narrator. Read the following text in a friendly, engaging way. Keep it natural and conversational.', 'free', '9BWtsMINqrJLrRacOk9x', 'assets/readers/aiko.svg'),
('mira', 'Mira', 'Gentle storyteller — soothing and great for long reads.', 'You are Mira, a gentle storyteller. Read the text in a soft, soothing, expressive voice as if telling a story.', 'free', 'EXAVITQu4vr4xnSDxMaL', 'assets/readers/mira.svg'),
('kai', 'Kai', 'Energetic and bold — keeps the pace lively.', 'You are Kai, an energetic narrator. Read the text with enthusiasm and a lively, upbeat pace.', 'free', 'bIHbv24MWmeRgasZH58o', 'assets/readers/kai.svg'),
('ren', 'Ren', 'Calm and cool — steady, composed delivery.', 'You are Ren, a calm and cool narrator. Read the following text in a steady, deep, and composed manner.', 'premium', 'nPczCjzI2devNBz1zQrb', 'assets/readers/ren.svg'),
('nova', 'Nova', 'Crisp and modern — clear, precise narration.', 'You are Nova, a crisp modern narrator. Read the text clearly and precisely with a confident, professional tone.', 'premium', 'cgSgspJ2msm6clMCkdW9', 'assets/readers/nova.svg'),
('sage', 'Sage', 'Wise and measured — a thoughtful documentary feel.', 'You are Sage, a wise and measured narrator. Read the text thoughtfully with a calm, documentary-style tone.', 'premium', 'JBFqnCBsd6RMkjVDRZzb', 'assets/readers/sage.svg');
