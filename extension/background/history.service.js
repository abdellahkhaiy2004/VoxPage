import { StorageService, StorageKeys } from '../shared/storage.js';

// Conversation history lives behind the background boundary. The popup never
// touches chrome.storage directly — it goes through GET/ADD/CLEAR_HISTORY messages.
// History is keyed per user (by email from the session); logged-out = 'guest'.
const MAX_HISTORY = 100;

export class HistoryService {
    async _key() {
        const email = await StorageService.get(StorageKeys.EMAIL);
        return `${StorageKeys.HISTORY}_${email || 'guest'}`;
    }

    async getHistory() {
        const key = await this._key();
        const stored = await StorageService.get(key);
        return Array.isArray(stored) ? stored : [];
    }

    async addEntry(sender, message) {
        const key = await this._key();
        const history = await this.getHistory();
        history.push({ sender, message, timestamp: Date.now() });
        // Keep only the most recent MAX_HISTORY entries.
        const trimmed = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
        await StorageService.set(key, trimmed);
        return trimmed;
    }

    async clearHistory() {
        const key = await this._key();
        await StorageService.remove(key);
        return true;
    }
}
