// Probes a list of ElevenLabs PREMADE (default) voices to find which ones your
// free API key can actually use. Uses only Text-to-Speech access (no Voices:Read).
// Run:  npm run voices:probe
//
// It sends a 1-character TTS request per voice (tiny credit cost) and reports
// OK (usable) vs blocked. Put a working voice_id in ELEVENLABS_DEFAULT_VOICE.
import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

const KEY = process.env.ELEVENLABS_API_KEY;
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
if (!KEY) {
    console.error('ELEVENLABS_API_KEY not set in backend/.env');
    process.exit(1);
}

// ElevenLabs CURRENT default voices (free-usable). Old defaults (Rachel/Arnold...)
// are deprecated and now rejected as "library" on free plans.
const CANDIDATES = [
    ['Aria', '9BWtsMINqrJLrRacOk9x'],
    ['Sarah', 'EXAVITQu4vr4xnSDxMaL'],
    ['Laura', 'FGY2WhTYpPnrIDTdsKH5'],
    ['Charlie', 'IKne3meq5aSn9XLyUdCD'],
    ['George', 'JBFqnCBsd6RMkjVDRZzb'],
    ['Callum', 'N2lVS1w4EtoT3dr4eOWO'],
    ['River', 'SAz9YHcvj6GT2YYXdXww'],
    ['Liam', 'TX3LPaxmHKxFdv7VOQHJ'],
    ['Charlotte', 'XB0fDUnXU5powFXDhCwa'],
    ['Alice', 'Xb7hH8MSUJpSbSDYk0k2'],
    ['Matilda', 'XrExE9yKIg1WjnnlVkGX'],
    ['Will', 'bIHbv24MWmeRgasZH58o'],
    ['Jessica', 'cgSgspJ2msm6clMCkdW9'],
    ['Eric', 'cjVigY5qzO86Huf0OWal'],
    ['Chris', 'iP95p4xoKVk53GoZ742B'],
    ['Brian', 'nPczCjzI2devNBz1zQrb'],
    ['Daniel', 'onwK4e9ZLuTAKqWW03F9'],
    ['Lily', 'pFZP5JQG7iQjIQuC4Bku'],
    ['Bill', 'pqHfZKP75CvOlQylNhV4']
];

console.log(`\nProbing ${CANDIDATES.length} premade voices with model ${MODEL}...\n`);
const usable = [];

for (const [name, id] of CANDIDATES) {
    try {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': KEY },
            body: JSON.stringify({ text: '.', model_id: MODEL })
        });
        if (r.ok) {
            console.log(`  OK       ${name.padEnd(10)} ${id}`);
            usable.push(id);
        } else {
            const j = await r.json().catch(() => ({}));
            const code = j?.detail?.code || r.status;
            console.log(`  blocked  ${name.padEnd(10)} ${id}  (${code})`);
        }
    } catch (e) {
        console.log(`  error    ${name.padEnd(10)} ${id}  (${e.message})`);
    }
}

console.log('');
if (usable.length) {
    console.log(`Usable voice — put this in backend/.env then restart:\n`);
    console.log(`  ELEVENLABS_DEFAULT_VOICE=${usable[0]}\n`);
} else {
    console.log('No premade voice worked. Your account/key may have no API-usable voices.');
    console.log('Check ElevenLabs > Voices for a voice marked usable, or verify the key has TTS access.\n');
}
