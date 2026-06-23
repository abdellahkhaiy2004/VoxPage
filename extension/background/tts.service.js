import { StorageService, StorageKeys } from '../shared/storage.js';

// TTS now runs through the backend proxy — NO provider keys live in the client.
const API_BASE = 'http://localhost:3000';

export class TTSService {
    async generateAudio(text, voiceId) {
        console.log(`[TTS] Requesting audio from backend (voice: ${voiceId})`);
        try {
            const token = await StorageService.get(StorageKeys.TOKEN);
            const response = await fetch(`${API_BASE}/tts/speak`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ text, voiceId })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Backend error ${response.status}`);
            }

            console.log('[TTS] Audio received from backend');
            return { success: true, audioBase64: data.audioBase64 };
        } catch (error) {
            console.error('[TTS] Error:', error);
            return { success: false, error: error.message, audioBase64: null };
        }
    }

    stopAudio() {
        // Audio is played in popup/content, so nothing to stop here
        console.log('[TTS] Stop audio requested');
    }
}
