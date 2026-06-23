// Integration tests against the backend (run it in TEST_MODE first):
//   npm run start:server   # with TEST_MODE=true in backend/.env
//   npm test
//
// Always runs the unit tests. The live backend flows are SKIPPED (not failed)
// when the server is unreachable, so `npm test` is useful even without a server.
import { runUnitTests } from './unit_test.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

async function check(name, fn) {
    try {
        await fn();
        passed++;
        console.log('  ✓', name);
    } catch (e) {
        failed++;
        console.error('  ✗', name, '—', e.message);
    }
}

async function serverIsUp() {
    try {
        // Unauthenticated /plan should respond (with 401) when the server is up.
        const r = await fetch(`${BASE_URL}/plan`);
        return r.status > 0;
    } catch {
        return false;
    }
}

async function runIntegration() {
    console.log('\n=== INTEGRATION TESTS ===');

    if (!(await serverIsUp())) {
        console.log(`  ⚠️  Backend not reachable at ${BASE_URL} — skipping integration flows.`);
        console.log('     Start it with TEST_MODE=true and re-run `npm test` for full coverage.');
        return true; // skipped, not failed
    }

    const email = `test_${Date.now()}@example.com`;
    const password = 'password123';

    // Auth: protected routes must reject unauthenticated requests (fail closed).
    await check('POST /ai/summarize without token → 401', async () => {
        const r = await fetch(`${BASE_URL}/ai/summarize`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'hello' })
        });
        if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    });
    await check('POST /tts/speak without token → 401', async () => {
        const r = await fetch(`${BASE_URL}/tts/speak`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'hello', voiceId: 'aiko' })
        });
        if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    });
    await check('GET /plan without token → 401', async () => {
        const r = await fetch(`${BASE_URL}/plan`);
        if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    });
    await check('POST /upgrade without token → 401', async () => {
        const r = await fetch(`${BASE_URL}/upgrade`, { method: 'POST' });
        if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    });

    // Register flow (needs DB). Verification code is console-only in TEST_MODE,
    // so we assert register succeeds and an unverified login is blocked.
    await check('POST /auth/register → success', async () => {
        const r = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const j = await r.json();
        if (!j.success) throw new Error(`register failed: ${j.error}`);
    });
    await check('POST /auth/login (unverified) → requiresVerification', async () => {
        const r = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const j = await r.json();
        if (j.success || !j.requiresVerification) {
            throw new Error('expected requiresVerification for unverified user');
        }
    });

    console.log(`\nIntegration: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

const unitOk = await runUnitTests();
const integrationOk = await runIntegration();

console.log(`\n=== RESULT: ${unitOk && integrationOk ? 'PASS' : 'FAIL'} ===`);
process.exit(unitOk && integrationOk ? 0 : 1);
