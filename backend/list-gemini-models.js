// Lists the Gemini models your API key can use with generateContent.
// Run:  npm run models:list      (reads GEMINI_API_KEY from backend/.env)
import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

const KEY = process.env.GEMINI_API_KEY;
const VERSION = process.env.GEMINI_API_VERSION || 'v1beta';

if (!KEY) {
    console.error('GEMINI_API_KEY not set in backend/.env');
    process.exit(1);
}

const r = await fetch(`https://generativelanguage.googleapis.com/${VERSION}/models?key=${KEY}`);
if (!r.ok) {
    console.error(`ListModels failed: ${r.status}`, (await r.text()).substring(0, 300));
    process.exit(1);
}

const { models = [] } = await r.json();
const usable = models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));

console.log(`\nModels supporting generateContent (${VERSION}):\n`);
for (const m of usable) {
    console.log('  ' + m.name.replace('models/', ''));
}
console.log('\nSet one of these as GEMINI_MODEL in backend/.env, then restart the server.');
