// Unit tests for pure core logic: ReaderStrategy, PlanStrategy, validateMessage.
// No network, no chrome.* — these always run.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { ReaderStrategy } from '../extension/background/strategies/reader.strategy.js';
import { PlanStrategy, getPlanStrategy } from '../extension/background/strategies/plan.strategy.js';
import { validateMessage, MessageTypes } from '../extension/shared/contracts.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ✓', name);
    } catch (e) {
        failed++;
        console.error('  ✗', name, '—', e.message);
    }
}

const freeReader = { id: 'aiko', name: 'Aiko', voiceId: 'aiko', personalityPrompt: 'cheerful', requiredPlan: 'free' };
const premiumReader = { id: 'ren', name: 'Ren', voiceId: 'ren', personalityPrompt: 'calm', requiredPlan: 'premium' };

export async function runUnitTests() {
    console.log('\n=== UNIT TESTS ===');

    console.log('ReaderStrategy:');
    test('getPersona returns personalityPrompt', () => {
        assert.equal(new ReaderStrategy(freeReader).getPersona(), 'cheerful');
    });
    test('getVoiceId returns voiceId', () => {
        assert.equal(new ReaderStrategy(premiumReader).getVoiceId(), 'ren');
    });
    test('requiresPremium reflects requiredPlan', () => {
        assert.equal(new ReaderStrategy(freeReader).requiresPremium(), false);
        assert.equal(new ReaderStrategy(premiumReader).requiresPremium(), true);
    });

    console.log('PlanStrategy:');
    test('free plan: not premium', () => {
        assert.equal(new PlanStrategy('free').isPremium(), false);
    });
    test('premium plan: is premium', () => {
        assert.equal(new PlanStrategy('premium').isPremium(), true);
    });
    test('free plan can use a free reader but not a premium one', () => {
        const free = getPlanStrategy('free');
        assert.equal(free.canUseReader(new ReaderStrategy(freeReader)), true);
        assert.equal(free.canUseReader(new ReaderStrategy(premiumReader)), false);
    });
    test('premium plan can use any reader', () => {
        const premium = getPlanStrategy('premium');
        assert.equal(premium.canUseReader(new ReaderStrategy(premiumReader)), true);
    });
    test('unknown plan defaults to free', () => {
        assert.equal(new PlanStrategy('garbage').isPremium(), false);
    });

    console.log('validateMessage:');
    test('valid LOGIN passes', () => {
        const r = validateMessage({ type: MessageTypes.LOGIN, username: 'a@b.com', password: 'x' });
        assert.equal(r.valid, true);
    });
    test('LOGIN missing password fails', () => {
        const r = validateMessage({ type: MessageTypes.LOGIN, username: 'a@b.com' });
        assert.equal(r.valid, false);
    });
    test('unknown type fails (fail closed)', () => {
        assert.equal(validateMessage({ type: 'TOTALLY_FAKE' }).valid, false);
    });
    test('non-object message fails', () => {
        assert.equal(validateMessage(null).valid, false);
        assert.equal(validateMessage('hi').valid, false);
    });
    test('no-field command (STOP_AUDIO) passes', () => {
        assert.equal(validateMessage({ type: MessageTypes.STOP_AUDIO }).valid, true);
    });
    test('ADD_HISTORY missing message fails', () => {
        assert.equal(validateMessage({ type: MessageTypes.ADD_HISTORY, sender: 'You' }).valid, false);
    });

    console.log(`\nUnit: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

// Run standalone when invoked directly: `node tests/unit_test.js`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runUnitTests().then(ok => process.exit(ok ? 0 : 1));
}
