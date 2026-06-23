// Background-side controller for the offscreen audio document.
// Audio plays in the offscreen doc so it persists after the popup closes.

let creating = null;

async function hasOffscreen() {
    try {
        if (chrome.offscreen?.hasDocument) return await chrome.offscreen.hasDocument();
    } catch (_) { /* fall through */ }
    return false;
}

async function ensureOffscreen() {
    if (await hasOffscreen()) return;
    if (!creating) {
        creating = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play AI reader audio that continues after the popup closes.'
        }).catch(() => { /* already exists / race — ignore */ });
    }
    await creating;
    creating = null;
}

export async function playAudio(audioBase64) {
    if (!audioBase64) return;
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'OFFSCREEN_PLAY', audioBase64 }).catch(() => {});
}

export async function stopAudio() {
    if (await hasOffscreen()) {
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'OFFSCREEN_STOP' }).catch(() => {});
    }
}
