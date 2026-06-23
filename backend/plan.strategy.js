// Server-side plan strategies (Strategy pattern). These are the authoritative
// limits — the extension UI mirrors them, but enforcement happens here.
// FREE_DAILY_READ_LIMIT is configurable via .env. Default 0 = unlimited;
// set it to a positive number (e.g. 10) to enforce a free-tier daily cap.
const FREE_DAILY_READ_LIMIT = process.env.FREE_DAILY_READ_LIMIT !== undefined
    ? parseInt(process.env.FREE_DAILY_READ_LIMIT, 10)
    : 0;

export const PLAN_STRATEGIES = {
    free: {
        name: 'free',
        // 0 (or NaN) means "no limit" for easy local testing.
        dailyReadLimit: (FREE_DAILY_READ_LIMIT > 0) ? FREE_DAILY_READ_LIMIT : Infinity,
        allowedVoices: ['aiko', 'mira', 'kai'] // free readers only
    },
    premium: {
        name: 'premium',
        dailyReadLimit: Infinity,           // unlimited
        allowedVoices: null                 // null = every voice allowed
    }
};

export function getPlanStrategy(plan) {
    return PLAN_STRATEGIES[plan] || PLAN_STRATEGIES.free;
}

export function isVoiceAllowed(strategy, voiceId) {
    if (!strategy.allowedVoices) return true; // premium: all voices
    return strategy.allowedVoices.includes(voiceId);
}
