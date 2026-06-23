import { MessageTypes } from '../../shared/contracts.js';
import * as ai from './ai.commands.js';
import * as auth from './auth.commands.js';
import * as reader from './reader.commands.js';
import * as history from './history.commands.js';

// Command registry: Map<MessageType, command>. Adding a feature = add one command
// + its schema in contracts.js. No switch statement to edit.
export function buildCommandRegistry() {
    const registry = new Map();

    // AI / TTS
    registry.set(MessageTypes.PROCESS_TEXT, ai.processText);
    registry.set(MessageTypes.CHAT, ai.chat);
    registry.set(MessageTypes.READ_PAGE, ai.readPage);
    registry.set(MessageTypes.STOP_AUDIO, ai.stopAudio);

    // Auth / plan / linking
    registry.set(MessageTypes.LOGIN, auth.login);
    registry.set(MessageTypes.REGISTER, auth.register);
    registry.set(MessageTypes.RESEND_CODE, auth.resendCode);
    registry.set(MessageTypes.VERIFY_EMAIL, auth.verifyEmail);
    registry.set(MessageTypes.GET_SESSION, auth.getSession);
    registry.set(MessageTypes.LOGOUT, auth.logout);
    registry.set(MessageTypes.FORGOT_PASSWORD, auth.forgotPassword);
    registry.set(MessageTypes.RESET_PASSWORD, auth.resetPassword);
    registry.set(MessageTypes.GET_PLAN, auth.getPlan);
    registry.set(MessageTypes.GET_USER_PLAN, auth.getUserPlan);
    registry.set(MessageTypes.UPGRADE_PLAN, auth.upgradePlan);
    registry.set(MessageTypes.LINK_GOOGLE, auth.linkGoogle);
    registry.set(MessageTypes.GET_LINK_STATUS, auth.getLinkStatus);

    // Readers
    registry.set(MessageTypes.GET_READERS, reader.getReaders);
    registry.set(MessageTypes.SET_READER, reader.setReader);

    // History
    registry.set(MessageTypes.GET_HISTORY, history.getHistory);
    registry.set(MessageTypes.ADD_HISTORY, history.addHistory);
    registry.set(MessageTypes.CLEAR_HISTORY, history.clearHistory);

    return registry;
}
