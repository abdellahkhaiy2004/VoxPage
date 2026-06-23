import { validateMessage } from '../shared/contracts.js';
import { AIService } from './ai.service.js';
import { AuthService } from './auth.service.js';
import { TTSService } from './tts.service.js';
import { ReaderService } from './reader.service.js';
import { HistoryService } from './history.service.js';
import { buildCommandRegistry } from './commands/registry.js';
import { handleAudioEnded } from './commands/ai.commands.js';

// Facade pattern: central entry point. Dispatches each message to a Command via
// the registry (Observer -> Command -> Facade -> Core). No giant switch.
export class BackgroundFacade {
    constructor() {
        // Shared context handed to every command.
        this.ctx = {
            aiService: new AIService(),
            authService: new AuthService(),
            ttsService: new TTSService(),
            readerService: new ReaderService(),
            historyService: new HistoryService()
        };
        this.commands = buildCommandRegistry();

        this.setupListeners();
        console.log('[Background] Service Worker Initialized');
    }

    setupListeners() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            // Security: validate sender.
            if (sender.id !== chrome.runtime.id) {
                console.error('[Security] Blocked message from unknown sender:', sender);
                return false;
            }

            // Internal event from the offscreen audio player (not a command).
            if (message && message.type === 'READER_AUDIO_ENDED') {
                handleAudioEnded();
                return false;
            }
            // Ignore messages addressed to the offscreen document.
            if (message && message.target === 'offscreen') {
                return false;
            }

            this.handleMessage(message, sendResponse);
            return true; // Keep channel open for async response.
        });
    }

    async handleMessage(message, sendResponse) {
        console.log('[Background] Received:', message);

        // Zero-trust: reject unknown types / malformed payloads before any work.
        const validation = validateMessage(message);
        if (!validation.valid) {
            console.warn('[Security] Rejected message:', validation.error, message);
            sendResponse({ success: false, error: 'Invalid message' });
            return;
        }

        const command = this.commands.get(message.type);
        if (!command) {
            // Fail closed (should be unreachable — validateMessage already filtered).
            console.warn('[Background] No command registered for:', message.type);
            sendResponse({ success: false, error: 'Unknown message type' });
            return;
        }

        try {
            const result = await command(message, this.ctx);
            sendResponse(result);
        } catch (error) {
            console.error('[Background] Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
}

// Initialize the Facade
new BackgroundFacade();
