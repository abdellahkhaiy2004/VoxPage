import { StorageService, StorageKeys } from '../shared/storage.js';

// AI text now runs through the backend proxy — NO provider keys live in the client.
const API_BASE = 'http://localhost:3000';

export class AIService {
    async _authHeaders() {
        const token = await StorageService.get(StorageKeys.TOKEN);
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    }

    async processText(text, personalityPrompt) {
        console.log('[AI Service] Requesting page summary from backend...');
        try {
            const headers = await this._authHeaders();
            const response = await fetch(`${API_BASE}/ai/summarize`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ text, personalityPrompt })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Backend error ${response.status}`);
            }
            return { success: true, data: data.data };
        } catch (error) {
            // Fail closed: never speak raw page text as if it were an AI answer.
            console.error('[AI Service] Error:', error);
            return { success: false, error: error.message };
        }
    }

    async chatWithAi(message, context, personalityPrompt) {
        console.log('[AI Service] Requesting chat answer from backend...');
        try {
            const headers = await this._authHeaders();
            const response = await fetch(`${API_BASE}/ai/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ message, context, personalityPrompt })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Backend error ${response.status}`);
            }
            return { success: true, data: data.data };
        } catch (error) {
            // Fail closed: surface the error to the popup instead of a fake answer.
            console.error('[AI Service] Chat Error:', error);
            return { success: false, error: error.message };
        }
    }
}
