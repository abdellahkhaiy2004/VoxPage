export const StorageKeys = {
    TOKEN: 'auth_token',
    PLAN: 'user_plan', // 'free' or 'premium'
    EMAIL: 'user_email', // User's email address
    READER: 'selected_reader', // Reader profile ID
    READERS_CACHE: 'cached_readers', // Last reader catalog fetched from the backend
    HISTORY: 'chat_history', // Per-user conversation history prefix
    LANGUAGE: 'app_language' // Selected UI language code (e.g. 'en', 'fr', 'ar')
};

export class StorageService {
    static async get(key) {
        const result = await chrome.storage.local.get(key);
        return result[key];
    }

    static async set(key, value) {
        await chrome.storage.local.set({ [key]: value });
    }

    static async remove(key) {
        await chrome.storage.local.remove(key);
    }
}
