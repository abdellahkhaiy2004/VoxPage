// Offscreen audio player. Plays the AI reader audio in a document owned by the
// background service worker, so playback survives the popup closing and isn't
// subject to web-page autoplay restrictions.
let audio = null;

chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.target !== 'offscreen') return;

    if (message.type === 'OFFSCREEN_PLAY') {
        if (audio) { audio.pause(); audio = null; }
        audio = new Audio(`data:audio/mpeg;base64,${message.audioBase64}`);
        audio.onended = () => {
            chrome.runtime.sendMessage({ type: 'READER_AUDIO_ENDED' }).catch(() => {});
        };
        audio.onerror = () => {
            chrome.runtime.sendMessage({ type: 'READER_AUDIO_ENDED' }).catch(() => {});
        };
        audio.play().catch(err => console.error('[Offscreen] play failed:', err));
    } else if (message.type === 'OFFSCREEN_STOP') {
        if (audio) { audio.pause(); audio = null; }
    }
});
