// Message types for communication between components
export const MessageTypes = {
    EXTRACT_TEXT: 'EXTRACT_TEXT', // UI -> Content
    TEXT_EXTRACTED: 'TEXT_EXTRACTED', // Content -> Back/UI
    PROCESS_TEXT: 'PROCESS_TEXT', // UI -> Background (AI)
    READ_PAGE: 'READ_PAGE', // UI -> Background (Read current page)
    CHAT: 'CHAT', // UI -> Background (Chat with AI about page)
    PLAY_AUDIO: 'PLAY_AUDIO', // Background -> UI/Audio
    STOP_AUDIO: 'STOP_AUDIO',
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    GET_PLAN: 'GET_PLAN',
    GET_SESSION: 'GET_SESSION',
    GET_READERS: 'GET_READERS',
    SET_READER: 'SET_READER',
    REGISTER: 'REGISTER',
    VERIFY_EMAIL: 'VERIFY_EMAIL',
    RESEND_CODE: 'RESEND_CODE',
    FORGOT_PASSWORD: 'FORGOT_PASSWORD',
    RESET_PASSWORD: 'RESET_PASSWORD',
    GET_HISTORY: 'GET_HISTORY', // UI -> Background (read per-user conversation history)
    ADD_HISTORY: 'ADD_HISTORY', // UI -> Background (append one history entry)
    CLEAR_HISTORY: 'CLEAR_HISTORY', // UI -> Background (wipe per-user history)
    GET_USER_PLAN: 'GET_USER_PLAN', // UI -> Background (fetch plan from backend + cache)
    UPGRADE_PLAN: 'UPGRADE_PLAN', // UI -> Background (upgrade to premium)
    LINK_GOOGLE: 'LINK_GOOGLE', // UI -> Background (link a Google account)
    GET_LINK_STATUS: 'GET_LINK_STATUS' // UI -> Background (which providers are linked)
};

export const SenderTypes = {
    POPUP: 'POPUP',
    CONTENT: 'CONTENT',
    BACKGROUND: 'BACKGROUND'
};

// Zero-trust message contract: every accepted message type maps to the list of
// fields it MUST carry. A type that is not a key here is rejected (fail closed).
export const MessageSchemas = {
    [MessageTypes.PROCESS_TEXT]: ['text'],
    [MessageTypes.READ_PAGE]: ['text'],
    [MessageTypes.CHAT]: ['text'],
    [MessageTypes.STOP_AUDIO]: [],
    [MessageTypes.LOGIN]: ['username', 'password'],
    [MessageTypes.LOGOUT]: [],
    [MessageTypes.GET_PLAN]: [],
    [MessageTypes.GET_SESSION]: [],
    [MessageTypes.GET_READERS]: [],
    [MessageTypes.SET_READER]: ['readerId'],
    [MessageTypes.REGISTER]: ['username', 'password'],
    [MessageTypes.VERIFY_EMAIL]: ['code'],
    [MessageTypes.RESEND_CODE]: ['username'],
    [MessageTypes.FORGOT_PASSWORD]: ['email'],
    [MessageTypes.RESET_PASSWORD]: ['email', 'code', 'newPassword'],
    [MessageTypes.GET_HISTORY]: [],
    [MessageTypes.ADD_HISTORY]: ['sender', 'message'],
    [MessageTypes.CLEAR_HISTORY]: [],
    [MessageTypes.GET_USER_PLAN]: [],
    [MessageTypes.UPGRADE_PLAN]: [],
    [MessageTypes.LINK_GOOGLE]: ['token'],
    [MessageTypes.GET_LINK_STATUS]: []
};

/**
 * Validate an incoming runtime message against MessageSchemas.
 * Fails closed: unknown type or any missing/empty required field is rejected.
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMessage(message) {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        return { valid: false, error: 'Malformed message' };
    }

    const schema = MessageSchemas[message.type];
    if (!schema) {
        return { valid: false, error: `Unknown message type: ${message.type}` };
    }

    for (const field of schema) {
        const value = message[field];
        if (value === undefined || value === null || value === '') {
            return { valid: false, error: `Missing required field: ${field}` };
        }
    }

    return { valid: true };
}
