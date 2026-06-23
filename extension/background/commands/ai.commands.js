// AI / TTS commands. Each command: async (message, ctx) => responseObject.
// ctx provides the shared services (aiService, ttsService, readerService, ...).
// Audio plays through the offscreen document so it persists after the popup closes.
import { playAudio, stopAudio as stopOffscreenAudio } from '../audio.player.js';

// Tab currently showing the "reading" overlay (so we can hide it when audio ends).
let readingTabId = null;

export async function processText(message, ctx) {
    const reader = await ctx.readerService.getActiveReaderStrategy();
    const aiResult = await ctx.aiService.processText(message.text, reader.getPersona());
    if (!aiResult.success) {
        return { success: false, error: aiResult.error || 'AI processing failed' };
    }
    const audioResult = await ctx.ttsService.generateAudio(aiResult.data, reader.getVoiceId());
    if (audioResult.success && audioResult.audioBase64) {
        await showReaderOverlay(reader.name);
        await playAudio(audioResult.audioBase64);
    }
    return { success: true, data: aiResult.data, reader: reader.name, audioSent: true };
}

export async function chat(message, ctx) {
    const reader = await ctx.readerService.getActiveReaderStrategy();
    const chatResult = await ctx.aiService.chatWithAi(message.text, message.context, reader.getPersona());
    if (!chatResult.success) {
        return { success: false, error: chatResult.error || 'AI chat failed' };
    }
    // Speak the answer via the offscreen player (persists when popup closes).
    const chatAudio = await ctx.ttsService.generateAudio(chatResult.data, reader.getVoiceId());
    if (chatAudio.success && chatAudio.audioBase64) {
        await showReaderOverlay(reader.name);
        await playAudio(chatAudio.audioBase64);
    }
    return { success: true, data: chatResult.data, reader: reader.name, audioSent: true };
}

export async function readPage(message, ctx) {
    const reader = await ctx.readerService.getActiveReaderStrategy();
    const readResult = await ctx.aiService.processText(message.text, reader.getPersona());
    if (!readResult.success) {
        return { success: false, error: readResult.error || 'AI processing failed' };
    }
    const processedText = readResult.data;
    const ttsResult = await ctx.ttsService.generateAudio(processedText, reader.getVoiceId());
    if (!(ttsResult.success && ttsResult.audioBase64)) {
        return { success: false, error: ttsResult.error || 'Failed to generate audio' };
    }
    await showReaderOverlay(reader.name);
    await playAudio(ttsResult.audioBase64);
    return { success: true, data: processedText, reader: reader.name, audioSent: true };
}

export async function stopAudio(message, ctx) {
    await stopOffscreenAudio();
    await hideReaderOverlay();
    return { success: true };
}

// Called by the background when the offscreen player reports playback finished.
export async function handleAudioEnded() {
    await hideReaderOverlay();
}

// --- page overlay (visual only; audio lives in the offscreen doc) ---
async function showReaderOverlay(readerName) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) return;
        readingTabId = tab.id;
        await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_READER_OVERLAY', readerName }).catch(() => {});
    } catch (_) { /* best effort */ }
}

async function hideReaderOverlay() {
    if (readingTabId == null) return;
    const tabId = readingTabId;
    readingTabId = null;
    try {
        await chrome.tabs.sendMessage(tabId, { type: 'HIDE_READER_OVERLAY' }).catch(() => {});
    } catch (_) { /* best effort */ }
}
