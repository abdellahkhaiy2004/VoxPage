import { StorageService, StorageKeys } from '../shared/storage.js';
import { ReaderStrategy } from './strategies/reader.strategy.js';

const BASE_URL = 'http://localhost:3000';

// Built-in fallback catalog. The authoritative list now lives in the backend
// `readers` table and is managed from the admin dashboard; this array is only
// used when the backend is unreachable AND nothing has been cached yet.
// `avatar` points to a bundled SVG (resolved in the popup via chrome.runtime.getURL).
export const Readers = [
    {
        id: "aiko",
        name: "Aiko",
        voiceId: "aiko",
        avatar: "assets/readers/aiko.svg",
        description: "Cheerful and friendly — reads in a warm, upbeat tone.",
        personalityPrompt: "You are Aiko, a cheerful narrator. Read the following text in a friendly, engaging way. Keep it natural and conversational.",
        requiredPlan: "free"
    },
    {
        id: "mira",
        name: "Mira",
        voiceId: "mira",
        avatar: "assets/readers/mira.svg",
        description: "Gentle storyteller — soothing and great for long reads.",
        personalityPrompt: "You are Mira, a gentle storyteller. Read the text in a soft, soothing, expressive voice as if telling a story.",
        requiredPlan: "free"
    },
    {
        id: "kai",
        name: "Kai",
        voiceId: "kai",
        avatar: "assets/readers/kai.svg",
        description: "Energetic and bold — keeps the pace lively.",
        personalityPrompt: "You are Kai, an energetic narrator. Read the text with enthusiasm and a lively, upbeat pace.",
        requiredPlan: "free"
    },
    {
        id: "ren",
        name: "Ren",
        voiceId: "ren",
        avatar: "assets/readers/ren.svg",
        description: "Calm and cool — steady, composed delivery.",
        personalityPrompt: "You are Ren, a calm and cool narrator. Read the following text in a steady, deep, and composed manner.",
        requiredPlan: "premium"
    },
    {
        id: "nova",
        name: "Nova",
        voiceId: "nova",
        avatar: "assets/readers/nova.svg",
        description: "Crisp and modern — clear, precise narration.",
        personalityPrompt: "You are Nova, a crisp modern narrator. Read the text clearly and precisely with a confident, professional tone.",
        requiredPlan: "premium"
    },
    {
        id: "sage",
        name: "Sage",
        voiceId: "sage",
        avatar: "assets/readers/sage.svg",
        description: "Wise and measured — a thoughtful documentary feel.",
        personalityPrompt: "You are Sage, a wise and measured narrator. Read the text thoughtfully with a calm, documentary-style tone.",
        requiredPlan: "premium"
    }
];

export class ReaderService {
    // Resolve the catalog: try the backend, fall back to the last cached list,
    // then to the bundled defaults. The fetched list is cached for offline use.
    async getAllReaders() {
        const fresh = await this._fetchReaders();
        if (fresh && fresh.length) {
            await StorageService.set(StorageKeys.READERS_CACHE, fresh);
            return fresh;
        }
        const cached = await StorageService.get(StorageKeys.READERS_CACHE);
        if (cached && cached.length) return cached;
        return Readers;
    }

    // GET /readers (JWT-protected). Returns null on any failure so callers fall back.
    async _fetchReaders() {
        const token = await StorageService.get(StorageKeys.TOKEN);
        if (!token) return null;
        try {
            const res = await fetch(`${BASE_URL}/readers`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            return (data && data.success && Array.isArray(data.readers)) ? data.readers : null;
        } catch (e) {
            console.warn('[Readers] fetch failed, using cache/defaults:', e.message);
            return null;
        }
    }

    async getActiveReader() {
        const readers = await this.getAllReaders();
        const readerId = await StorageService.get(StorageKeys.READER);
        return readers.find(r => r.id === readerId) || readers[0];
    }

    // Active reader wrapped in its behavior strategy (persona + voice).
    async getActiveReaderStrategy() {
        return new ReaderStrategy(await this.getActiveReader());
    }

    // Raw stored selection (undefined when the user has never picked one).
    async getSelectedReaderId() {
        return await StorageService.get(StorageKeys.READER);
    }

    async setReader(readerId) {
        const readers = await this.getAllReaders();
        const reader = readers.find(r => r.id === readerId);
        if (reader) {
            await StorageService.set(StorageKeys.READER, readerId);
            return true;
        }
        return false;
    }
}
