// Lists the ElevenLabs voices your API key can use, with their voice_id.
// Run:  npm run voices:list
// NOTE: the API key needs "Voices: Read" access (or be unrestricted).
import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
    console.error('ELEVENLABS_API_KEY not set in backend/.env');
    process.exit(1);
}

const r = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': KEY }
});
if (!r.ok) {
    console.error(`Failed: ${r.status}`, (await r.text()).substring(0, 300));
    console.error('\nIf 401: enable "Voices: Read" on your API key (or use an unrestricted key).');
    process.exit(1);
}

const { voices = [] } = await r.json();
console.log(`\nVoices your account can use (${voices.length}):\n`);
for (const v of voices) {
    const cat = v.category ? ` [${v.category}]` : '';
    console.log(`  ${v.voice_id}  ${v.name}${cat}`);
}
console.log('\nPut one voice_id in ELEVENLABS_DEFAULT_VOICE in backend/.env, then restart.');
