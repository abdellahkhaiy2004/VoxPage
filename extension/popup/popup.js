import { MessageTypes } from '../shared/contracts.js';
import { initLanguage, nextLanguage, LANGUAGE_NAMES } from './i18n.js';
import { canUseReader } from '../shared/plan.rules.js';

// ========== STATE ==========
let currentView = 'auth'; // 'auth', 'main', 'settings', 'account', 'readers'
let isLoggedIn = false;
let userPlan = 'free';
let userEmail = '';
let readers = [];
let activeReader = null;
let hasSelectedReader = false; // true once the user has explicitly picked a reader
let currentLanguage = 'en';
let codeTimerInterval = null;
let codeTimerSeconds = 0;
let conversationHistory = []; // Per-user conversation history
let isResizing = false;
let startY = 0;
let startHeight = 0;

// ========== DOM HELPERS ==========
// Resilient lookups: a missing element logs once and is skipped, instead of
// throwing a TypeError that would abort the rest of setupEventListeners().
function $(id) {
    const el = document.getElementById(id);
    if (!el) console.error('[Popup] Missing element:', id);
    return el;
}

function on(id, evt, fn) {
    const el = $(id);
    if (el) el.addEventListener(evt, fn);
}

// Escape user/AI text before inserting into innerHTML (prevents markup injection).
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Get page text from the content script. If it isn't loaded in this tab yet
// (e.g. the tab was open before the extension loaded), inject it and retry —
// instead of silently degrading to the page title / empty context.
async function extractPageText(tabId) {
    try {
        const res = await chrome.tabs.sendMessage(tabId, { type: MessageTypes.EXTRACT_TEXT });
        if (res && res.success && res.text) return res.text;
    } catch (e) {
        /* content script not present — inject below */
    }
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
        await new Promise(r => setTimeout(r, 150));
        const res = await chrome.tabs.sendMessage(tabId, { type: MessageTypes.EXTRACT_TEXT });
        if (res && res.success && res.text) return res.text;
    } catch (e) {
        console.warn('extractPageText failed (restricted page?):', e);
    }
    return '';
}

// Send a message to the background service worker. Returns the response, or null
// (with a clear toast) when the worker/backend is unreachable — never silent.
async function sendToBackground(message) {
    try {
        const response = await chrome.runtime.sendMessage(message);
        if (response === undefined) {
            showToast('Cannot reach the extension service — try reloading the extension.', 'error');
            return null;
        }
        return response;
    } catch (e) {
        console.error('[Popup] sendMessage failed:', e);
        showToast('Cannot reach the server — is the backend running?', 'error');
        return null;
    }
}

// ========== VIEW NAVIGATION ==========
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        v.classList.add('hidden'); // Ensure others are hidden
    });
    const target = document.getElementById(`view-${viewId}`);
    if (target) {
        target.classList.remove('hidden'); // Critical: Remove hidden
        target.classList.add('active');
    }
    currentView = viewId;
}

// ========== TOAST NOTIFICATIONS ==========
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
        error: '❌',
        success: '✅',
        warning: '⚠️',
        info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close">×</button>
    `;

    // Close button handler
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.remove();
    });

    container.appendChild(toast);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 4000);
}

// ========== INIT ==========
async function init() {
    setupEventListeners(); // 0. Setup Listeners IMMEDIATELY
    currentLanguage = await initLanguage(); // Apply persisted UI language

    try {
        // Check for existing session first
        const sessionRes = await chrome.runtime.sendMessage({ type: MessageTypes.GET_SESSION });

        if (sessionRes && sessionRes.success && sessionRes.isLoggedIn) {
            // User is already logged in - restore session
            isLoggedIn = true;
            userEmail = sessionRes.email || '';
            userPlan = sessionRes.plan || 'free';

            // Load readers and enter the app (onboarding if no reader picked yet)
            await enterApp();
            console.log('[Popup] Session restored for:', userEmail);
            return;
        }

        // Check Login & Auth State (for verification flow)
        const response = await chrome.runtime.sendMessage({ type: MessageTypes.GET_PLAN });

        if (response && response.success) {
            // Check if we are stuck in Verification
            if (response.authState && response.authState.status === 'AWAITING_VERIFICATION') {
                showView('auth');
                switchToVerifyMode(response.authState.email);
                return;
            }
        }
    } catch (e) {
        console.warn('Backend init check failed:', e);
    }

    // Default: show auth view
    showView('auth');
}

async function loadReaders() {
    try {
        const readersRes = await chrome.runtime.sendMessage({ type: MessageTypes.GET_READERS });
        if (readersRes && readersRes.success) {
            readers = readersRes.readers;
            const selectedId = readersRes.selectedReaderId;
            const matched = readers.find(r => r.id === selectedId);
            hasSelectedReader = !!matched;
            activeReader = matched || readers[0];
            renderReadersList();
        }
    } catch (e) {
        console.warn('Reader load failed:', e);
    }
}

// Fetch the authoritative plan from the backend (not just the login response).
async function refreshPlan() {
    try {
        const res = await chrome.runtime.sendMessage({ type: MessageTypes.GET_USER_PLAN });
        if (res && res.success && res.plan) {
            userPlan = res.plan;
        }
    } catch (e) {
        console.warn('Plan refresh failed:', e);
    }
}

// Shared post-auth flow: load data, then route to onboarding or main view.
async function enterApp() {
    await loadReaders();
    await refreshPlan();
    await loadConversationHistory();
    updateMainView();
    if (!hasSelectedReader) {
        // First-time user: require a reader pick before reaching the main view.
        showToast('Choose your AI reader to get started', 'info');
        showView('readers');
    } else {
        showView('main');
    }
}

// ========== CONVERSATION HISTORY ==========
// History I/O lives behind the background boundary — the popup never touches
// chrome.storage directly. It talks to the background via GET/ADD/CLEAR_HISTORY.

async function loadConversationHistory() {
    try {
        const res = await chrome.runtime.sendMessage({ type: MessageTypes.GET_HISTORY });
        conversationHistory = (res && res.success && Array.isArray(res.history)) ? res.history : [];
    } catch (e) {
        console.warn('Failed to load history:', e);
        conversationHistory = [];
    }
    renderHistory();
}

async function addToHistory(sender, message) {
    // Optimistic local update so the UI renders instantly...
    conversationHistory.push({ sender, message, timestamp: Date.now() });
    if (conversationHistory.length > 100) {
        conversationHistory = conversationHistory.slice(-100);
    }
    // ...then persist through the background (the source of truth).
    try {
        const res = await chrome.runtime.sendMessage({
            type: MessageTypes.ADD_HISTORY,
            sender,
            message
        });
        if (res && res.success && Array.isArray(res.history)) {
            conversationHistory = res.history;
        }
    } catch (e) {
        console.warn('Failed to persist history:', e);
    }
}

function renderHistory() {
    const historyBox = document.getElementById('chat-history');
    if (conversationHistory.length === 0) {
        historyBox.innerHTML = '<div class="history-placeholder">No conversation history yet</div>';
        return;
    }
    // Reverse to show newest on top
    const reversed = [...conversationHistory].reverse();
    historyBox.innerHTML = reversed.map(item => {
        const isUser = item.sender === 'You';
        const bubble = isUser ? 'user-msg' : 'ai-msg';
        const row = isUser ? 'row-user' : 'row-ai';
        return `<div class="msg-row ${row}">
            <div class="${bubble}">
                <span class="msg-sender">${escapeHtml(item.sender)}</span>
                <span class="msg-text">${escapeHtml(item.message)}</span>
            </div>
        </div>`;
    }).join('');
    // Scroll to top (newest)
    historyBox.scrollTop = 0;
}

function clearHistoryDisplay() {
    conversationHistory = [];
    const historyBox = document.getElementById('chat-history');
    historyBox.innerHTML = '<div class="history-placeholder">No conversation history yet</div>';
}

// Helper to toggle Register form to "Verify Mode"
function switchToVerifyMode(email) {
    document.getElementById('tab-register').click(); // Switch to register tab
    document.getElementById('register-email').value = email;
    document.getElementById('register-password').disabled = true;
    document.getElementById('register-password-confirm').disabled = true;
    document.getElementById('btn-register').classList.add('hidden'); // Hide register button
    document.getElementById('register-status').textContent = 'Please enter verification code from email.';
    // Ensure verify row is visible (it is by default in this form)
}

function resetRegisterMode() {
    document.getElementById('register-password').disabled = false;
    document.getElementById('register-password-confirm').disabled = false;
    document.getElementById('btn-register').classList.remove('hidden');
    document.getElementById('register-status').textContent = '';
}

// ========== CODE TIMER ==========
function startCodeTimer() {
    const btn = document.getElementById('btn-resend-code');
    codeTimerSeconds = 5 * 60; // 5 minutes
    btn.disabled = true;
    btn.classList.add('timer-active');

    updateTimerDisplay();

    codeTimerInterval = setInterval(() => {
        codeTimerSeconds--;
        updateTimerDisplay();

        if (codeTimerSeconds <= 0) {
            stopCodeTimer();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const btn = document.getElementById('btn-resend-code');
    const minutes = Math.floor(codeTimerSeconds / 60);
    const seconds = codeTimerSeconds % 60;
    btn.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function stopCodeTimer() {
    if (codeTimerInterval) {
        clearInterval(codeTimerInterval);
        codeTimerInterval = null;
    }
    codeTimerSeconds = 0;
    const btn = document.getElementById('btn-resend-code');
    btn.disabled = false;
    btn.classList.remove('timer-active');
    btn.textContent = 'Send Code';
}

// ========== EVENT LISTENERS ==========
function setupEventListeners() {
  console.log('--- Setting up Event Listeners ---');
  try {
    // Auth Tabs
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const formLogin = document.getElementById('form-login');
    const formRegister = document.getElementById('form-register');

    console.log('Elements found:', {
        tabLogin: !!tabLogin,
        tabRegister: !!tabRegister,
        formLogin: !!formLogin,
        formRegister: !!formRegister
    });

    if (tabLogin) {
        tabLogin.addEventListener('click', () => {
            console.log('Clicked: Login Tab');
            tabLogin.classList.add('active');
            if (tabRegister) tabRegister.classList.remove('active');
            if (formLogin) formLogin.classList.remove('hidden');
            if (formRegister) formRegister.classList.add('hidden');
            resetRegisterMode();
        });
    } else {
        console.error('CRITICAL: tab-login element missing!');
    }

    if (tabRegister) {
        console.log('Adding listener to Register Tab');
        tabRegister.addEventListener('click', () => {
            console.log('Clicked: Register Tab');
            tabRegister.classList.add('active');
            if (tabLogin) tabLogin.classList.remove('active');
            if (formRegister) formRegister.classList.remove('hidden');
            if (formLogin) formLogin.classList.add('hidden');
            resetRegisterMode();
        });
    } else {
        console.error('CRITICAL: tab-register element missing!');
    }

    // Login
    on('btn-connect', 'click', handleLogin);

    // Register (Stub)
    on('btn-register', 'click', handleRegister);

    // Send/Resend Code
    on('btn-resend-code', 'click', handleResendCode);

    // Verify Email
    on('btn-verify-email', 'click', handleVerifyEmail);

    // Settings Navigation
    on('btn-settings', 'click', () => showView('settings'));
    on('btn-settings-back', 'click', () => showView('main'));

    // Account Settings
    on('btn-account-settings', 'click', () => {
        showView('account');
        updateLinkStatus();
    });
    on('btn-account-back', 'click', () => showView('settings'));

    // Link Google account
    on('btn-link-google', 'click', handleLinkGoogle);

    // Change language
    on('btn-change-language', 'click', handleChangeLanguage);

    // Logout
    on('btn-logout', 'click', handleLogout);
    on('btn-account-logout', 'click', handleLogout);

    // Clear History
    on('btn-clear-history', 'click', () => {
        showConfirmModal('Are you sure you want to clear all conversation history?', async () => {
            try {
                await chrome.runtime.sendMessage({ type: MessageTypes.CLEAR_HISTORY });
            } catch (e) {
                console.warn('Failed to clear history:', e);
            }
            clearHistoryDisplay();
            showToast('History cleared', 'success');
        });
    });

    // Upgrade
    on('btn-upgrade', 'click', handleUpgrade);
    on('btn-upgrade-inline', 'click', handleUpgrade);

    // Change Password (uses forgot password flow)
    on('btn-change-password', 'click', handleChangePassword);

    // Modal Events
    on('btn-modal-cancel', 'click', hideModal);

    // Reader Selection
    on('btn-show-readers', 'click', () => showView('readers'));
    on('btn-readers-back', 'click', () => {
        // During first-run onboarding, require a pick before leaving the catalog.
        if (!hasSelectedReader) {
            showToast('Please choose a reader first', 'warning');
            return;
        }
        showView('main');
    });

    // Reader Search
    on('reader-search', 'input', (e) => renderReadersList(e.target.value.toLowerCase()));

    // Read Page (click on avatar)
    on('btn-read-page', 'click', handleReadPage);

    // Chat Send
    on('btn-send', 'click', handleSendMessage);
    on('chat-input', 'keypress', (e) => { if (e.key === 'Enter') handleSendMessage(); });

    // Microphone (speech-to-text)
    on('btn-mic', 'click', handleMicInput);

    // Password Strength
    on('register-password', 'input', (e) => {
        const val = e.target.value;
        const strengthEl = $('password-strength');
        if (!strengthEl) return;
        if (val.length < 6) { strengthEl.textContent = '(BAD)'; strengthEl.style.color = '#d32f2f'; }
        else if (val.length < 10) { strengthEl.textContent = '(NORMAL)'; strengthEl.style.color = '#f5a623'; }
        else { strengthEl.textContent = '(GOOD)'; strengthEl.style.color = '#4caf50'; }
    });

    // Forgot Password
    on('btn-forgot', 'click', showForgotPasswordForm);
    on('btn-forgot-back', 'click', hideForgotPasswordForm);
    on('btn-forgot-send-code', 'click', handleForgotSendCode);
    on('btn-reset-password', 'click', handleResetPassword);

    // Resize Handle
    on('resize-handle', 'mousedown', startResize);

    console.log('--- Event Listeners ready ---');
  } catch (e) {
    console.error('[Popup] setupEventListeners failed:', e);
  }
}


// ========== RESIZE LOGIC ==========
function startResize(e) {
    if (currentView !== 'main') return; // Only resize in main view
    isResizing = true;
    startY = e.clientY;
    const viewMain = document.getElementById('view-main');
    startHeight = parseInt(window.getComputedStyle(viewMain).height, 10);

    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);

    // Prevent selection during resize
    document.body.style.userSelect = 'none';
}

function resize(e) {
    if (!isResizing) return;

    const dy = e.clientY - startY;
    const newHeight = startHeight + dy;

    // Min height 400px, Max height 700px
    if (newHeight >= 400 && newHeight <= 700) {
        document.getElementById('view-main').style.height = `${newHeight}px`;
    }
}

function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.userSelect = '';
}

// ========== FORGOT PASSWORD HELPERS ==========
function showForgotPasswordForm() {
    document.getElementById('form-login').classList.add('hidden');
    document.getElementById('form-register').classList.add('hidden');
    document.getElementById('form-forgot').classList.remove('hidden');
}

function hideForgotPasswordForm() {
    document.getElementById('form-forgot').classList.add('hidden');
    document.getElementById('form-login').classList.remove('hidden');
    // Clear forgot form
    document.getElementById('forgot-email').value = '';
    document.getElementById('forgot-new-password').value = '';
    document.getElementById('forgot-confirm-password').value = '';
    document.getElementById('forgot-code').value = '';
}

async function handleForgotSendCode() {
    const email = document.getElementById('forgot-email').value;

    if (!email) {
        showToast('Please enter your email', 'warning');
        return;
    }

    const response = await chrome.runtime.sendMessage({
        type: MessageTypes.FORGOT_PASSWORD,
        email: email
    });

    if (response && response.success) {
        showToast('Reset code sent to your email!', 'success');
    } else {
        showToast(response.error || 'Failed to send reset code', 'error');
    }
}

async function handleResetPassword() {
    const email = document.getElementById('forgot-email').value;
    const newPassword = document.getElementById('forgot-new-password').value;
    const confirmPassword = document.getElementById('forgot-confirm-password').value;
    const code = document.getElementById('forgot-code').value;

    if (!email || !newPassword || !confirmPassword || !code) {
        showToast('Please fill all fields', 'warning');
        return;
    }

    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showToast('Password must be at least 6 characters', 'warning');
        return;
    }

    const response = await chrome.runtime.sendMessage({
        type: MessageTypes.RESET_PASSWORD,
        email: email,
        code: code,
        newPassword: newPassword
    });

    if (response && response.success) {
        showToast('Password reset successful! Please login.', 'success');
        hideForgotPasswordForm();
    } else {
        showToast(response.error || 'Failed to reset password', 'error');
    }
}

async function handleChangePassword() {
    // Switch to forgot password form with email pre-filled
    showView('auth');
    showForgotPasswordForm();
    document.getElementById('forgot-email').value = userEmail;

    // Automatically send the reset code
    const response = await chrome.runtime.sendMessage({
        type: MessageTypes.FORGOT_PASSWORD,
        email: userEmail
    });

    if (response && response.success) {
        showToast('Reset code sent to your email!', 'success');
    } else {
        showToast(response.error || 'Failed to send reset code', 'error');
    }
}

// ========== READ PAGE ==========
let isReading = false;
let readingTimer = null;
let readingSeconds = 0;

async function handleReadPage() {
    const avatarWrapper = document.getElementById('btn-read-page');

    // If already reading, stop
    if (isReading) {
        stopReading();
        return;
    }

    showToast('Extracting page content...', 'info');

    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            showToast('No active tab found', 'error');
            return;
        }

        // Extract text from page (injects the content script if needed)
        let pageText = await extractPageText(tab.id);
        if (!pageText) pageText = tab.title || '';

        if (!pageText || pageText.length < 10) {
            showToast('No content to read on this page', 'warning');
            return;
        }

        // Start reading state
        startReading();
        showToast('Processing with AI and generating voice...', 'info');

        // Add to history
        addToHistory('You', `[Reading page: ${tab.title}]`);
        renderHistory();

        // Send to background for AI processing + TTS
        const response = await chrome.runtime.sendMessage({
            type: MessageTypes.READ_PAGE,
            text: pageText.substring(0, 3000) // Limit text length
        });

        if (response && response.success) {
            addToHistory(response.reader || 'Aiko', response.data);
            renderHistory();

            // Audio is now sent directly by background to content script
            // Just show success message
            if (response.audioSent) {
                showToast(`${response.reader} is reading...`, 'success');
            }
        } else {
            stopReading();
            showToast(response?.error || 'Failed to read page', 'error');
        }

    } catch (error) {
        console.error('Read page error:', error);
        stopReading();
        showToast('Error reading page: ' + error.message, 'error');
    }
}

let currentAudio = null;

function playAudioFromBase64(base64Audio) {
    // Stop any existing audio
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    // Create audio from base64
    const audioSrc = `data:audio/mpeg;base64,${base64Audio}`;
    currentAudio = new Audio(audioSrc);

    currentAudio.onended = () => {
        console.log('[Popup] Audio finished');
        stopReading();
    };

    currentAudio.onerror = (e) => {
        console.error('[Popup] Audio error:', e);
        stopReading();
        showToast('Audio playback error', 'error');
    };

    currentAudio.play();
}

function startReading() {
    isReading = true;
    readingSeconds = 0;
    const avatarWrapper = document.getElementById('btn-read-page');
    avatarWrapper.classList.add('reading');

    // Show overlay on the web page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'SHOW_READER_OVERLAY',
                readerName: activeReader?.name || 'Aiko'
            }).catch(() => { });
        }
    });

    // Start timer
    readingTimer = setInterval(() => {
        readingSeconds++;
        const mins = Math.floor(readingSeconds / 60);
        const secs = readingSeconds % 60;
        document.getElementById('reader-timer').textContent =
            `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

function stopReading() {
    isReading = false;
    const avatarWrapper = document.getElementById('btn-read-page');
    avatarWrapper.classList.remove('reading');

    if (readingTimer) {
        clearInterval(readingTimer);
        readingTimer = null;
    }

    // Stop audio playback
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    // Hide overlay on the web page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'HIDE_READER_OVERLAY'
            }).catch(() => { });
        }
    });
}

// ========== HANDLERS ==========
async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showToast('Please enter email and password', 'warning');
        return;
    }

    const response = await sendToBackground({
        type: MessageTypes.LOGIN,
        username: email,
        password: password
    });

    if (!response) return; // backend unreachable — toast already shown

    if (response.success) {
        isLoggedIn = true;
        userEmail = email;
        userPlan = response.plan;

        await enterApp();
    } else if (response.requiresVerification) {
        switchToVerifyMode(email);
        showToast('Please verify your email first', 'warning');
    } else {
        showToast('Login failed: ' + (response.error || 'Unknown error'), 'error');
    }
}

async function handleRegister() {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-password-confirm').value;

    if (!email || !password) {
        showToast('Please fill all fields', 'warning');
        return;
    }
    if (password !== confirm) {
        showToast('Passwords do not match', 'error');
        return;
    }

    const response = await sendToBackground({
        type: MessageTypes.REGISTER,
        username: email,
        password: password
    });

    if (!response) return; // backend unreachable — toast already shown

    if (response.success) {
        switchToVerifyMode(email);
        startCodeTimer();
        showToast('Verification code sent! Check your email', 'success');
    } else {
        showToast('Registration failed: ' + (response.error || 'Unknown error'), 'error');
    }
}

async function handleResendCode() {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    if (!email) {
        showToast('Please enter your email', 'warning');
        return;
    }

    // If we have a password, try to REGISTER first (handles "User not found" case)
    if (password) {
        const regResponse = await sendToBackground({
            type: MessageTypes.REGISTER,
            username: email,
            password: password
        });

        if (!regResponse) return; // backend unreachable — toast already shown

        if (regResponse.success) {
            showToast('Account created & Code sent!', 'success');
            switchToVerifyMode(email);
            startCodeTimer();
            return;
        }

        // If error is NOT "User already exists", show it
        if (regResponse.error && !regResponse.error.includes('already exists')) {
            showToast('Error: ' + regResponse.error, 'error');
            return;
        }
        // If "User already exists", fall through to Resend logic below
    }

    // Fallback: Try RESEND (for existing users or if password empty)
    const response = await sendToBackground({
        type: MessageTypes.RESEND_CODE,
        username: email
    });

    if (!response) return; // backend unreachable — toast already shown

    if (response.success) {
        startCodeTimer();
        showToast('Code resent! Check your email', 'success');
    } else {
        showToast('Failed to send code: ' + (response.error || 'User not found'), 'error');
    }
}

async function handleVerifyEmail() {
    const code = document.getElementById('register-code').value;
    if (!code) {
        showToast('Please enter the verification code', 'warning');
        return;
    }

    const response = await sendToBackground({
        type: MessageTypes.VERIFY_EMAIL,
        code: code
    });

    if (!response) return; // backend unreachable — toast already shown

    if (response.success) {
        document.getElementById('btn-verify-email').textContent = 'verified';
        document.getElementById('register-status').textContent = 'Email Verified! Please Login.';
        showToast('Email verified successfully!', 'success');
        resetRegisterMode();
        // Switch to login tab
        document.getElementById('tab-login').click();
    } else {
        showToast('Verification failed: ' + (response.error || 'Unknown error'), 'error');
    }
}

async function handleLogout() {
    try {
        await chrome.runtime.sendMessage({ type: MessageTypes.LOGOUT });
    } catch (e) {
        console.warn('Logout message failed:', e);
    }
    isLoggedIn = false;
    userEmail = '';
    userPlan = 'free';
    clearHistoryDisplay();
    showView('auth');
}

// ========== MICROPHONE (HANDS-FREE SPEECH-TO-TEXT) ==========
let recognition = null;
let liveMic = false;        // true while continuous listening is active

function micLang() {
    return currentLanguage === 'ar' ? 'ar-SA'
        : currentLanguage === 'fr' ? 'fr-FR'
        : 'en-US';
}

// Extension popups can't reliably show the mic permission prompt, so we open a
// dedicated page (same extension origin) that requests it once.
async function ensureMicPermission() {
    try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (status.state === 'granted') return true;
    } catch (_) { /* permissions API may not support 'microphone' — fall through */ }
    showToast('Allow the microphone in the tab that just opened, then click the mic again.', 'info');
    chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
    return false;
}

async function handleMicInput() {
    // Toggle off if already listening.
    if (liveMic) {
        stopLiveMic();
        return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Voice input is not supported in this browser', 'warning');
        return;
    }
    if (!(await ensureMicPermission())) return;
    startLiveMic(SpeechRecognition);
}

function startLiveMic(SpeechRecognition) {
    const micBtn = $('btn-mic');
    recognition = new SpeechRecognition();
    recognition.lang = micLang();
    recognition.continuous = true;       // keep listening across phrases
    recognition.interimResults = true;   // show words as they're spoken

    recognition.onstart = () => {
        liveMic = true;
        if (micBtn) micBtn.classList.add('listening');
        showToast('Listening… speak your question (click mic to stop)', 'info');
    };

    recognition.onresult = (event) => {
        const input = $('chat-input');
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalText += t; else interim += t;
        }
        if (input && interim) input.value = interim;   // live preview
        const phrase = finalText.trim();
        if (phrase) {
            if (input) input.value = phrase;
            handleSendMessage();                       // auto-send finished phrase
        }
    };

    recognition.onerror = (event) => {
        console.error('[Mic] error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            stopLiveMic();
            ensureMicPermission(); // permission missing/revoked -> reopen grant page
        } else if (event.error === 'no-speech' || event.error === 'aborted') {
            // transient — onend will auto-restart while liveMic is true
        } else {
            showToast(`Voice input error: ${event.error}`, 'error');
        }
    };

    recognition.onend = () => {
        // Continuous mode: Chrome stops after a pause, so restart while active.
        if (liveMic && recognition) {
            try { recognition.start(); } catch (_) { /* ignore double-start */ }
        } else if (micBtn) {
            micBtn.classList.remove('listening');
        }
    };

    try {
        recognition.start();
    } catch (err) {
        console.error('[Mic] failed to start:', err);
        showToast('Could not start voice input', 'error');
        stopLiveMic();
    }
}

function stopLiveMic() {
    liveMic = false;
    if (recognition) {
        try { recognition.stop(); } catch (_) {}
        recognition = null;
    }
    const micBtn = $('btn-mic');
    if (micBtn) micBtn.classList.remove('listening');
}

async function handleSendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    // Add user message to history
    addToHistory('You', text);
    renderHistory();
    input.value = '';

    // Get page text first (injects the content script if needed) so the AI has context
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const pageText = tab ? await extractPageText(tab.id) : '';

        const response = await sendToBackground({
            type: MessageTypes.CHAT,
            text: text,
            context: pageText // Send full context, let background/AI decide how much to use
        });

        if (!response) return; // backend unreachable — toast already shown

        if (response.success) {
            // Audio is played by the background offscreen player (persists on close).
            addToHistory(response.reader, response.data);
            renderHistory();
        } else {
            showToast(response.error || 'Could not get an answer', 'error');
        }
    } catch (err) {
        console.error('Send error:', err);
    }
}

// ========== PLAN UPGRADE ==========
async function handleUpgrade() {
    showToast('Upgrading your plan...', 'info');
    try {
        const res = await chrome.runtime.sendMessage({ type: MessageTypes.UPGRADE_PLAN });
        if (res && res.success) {
            userPlan = res.plan || 'premium';
            updateMainView();
            renderReadersList(); // premium readers are now selectable
            showToast('Upgraded to premium! 🎉 All readers unlocked', 'success');
        } else {
            showToast(res?.error || 'Upgrade failed', 'error');
        }
    } catch (e) {
        console.error('Upgrade error:', e);
        showToast('Upgrade failed. Please try again.', 'error');
    }
}

// ========== GOOGLE LINKING ==========
function setGoogleLinkedUI(linked) {
    const btn = document.getElementById('btn-link-google');
    if (!btn) return;
    const span = btn.querySelector('span');
    if (linked) {
        if (span) span.textContent = 'Already linked';
        btn.classList.add('linked');
        btn.disabled = true;
    } else {
        if (span) span.textContent = 'Link Google';
        btn.classList.remove('linked');
        btn.disabled = false;
    }
}

async function updateLinkStatus() {
    try {
        const res = await chrome.runtime.sendMessage({ type: MessageTypes.GET_LINK_STATUS });
        if (res && res.success) setGoogleLinkedUI(!!res.google);
    } catch (e) {
        console.warn('Link status check failed:', e);
    }
}

function handleLinkGoogle() {
    if (!chrome.identity || !chrome.identity.getAuthToken) {
        showToast('Google linking is not available', 'warning');
        return;
    }
    showToast('Connecting to Google...', 'info');
    chrome.identity.getAuthToken({ interactive: true }, async (result) => {
        if (chrome.runtime.lastError || !result) {
            showToast(chrome.runtime.lastError?.message || 'Google sign-in cancelled', 'error');
            return;
        }
        // MV3 may return either a string token or an object { token }.
        const googleToken = typeof result === 'string' ? result : result.token;
        if (!googleToken) {
            showToast('Could not get Google token', 'error');
            return;
        }
        try {
            const res = await chrome.runtime.sendMessage({ type: MessageTypes.LINK_GOOGLE, token: googleToken });
            if (res && res.success) {
                setGoogleLinkedUI(true);
                showToast('Google account linked!', 'success');
            } else {
                showToast(res?.error || 'Failed to link Google account', 'error');
            }
        } catch (e) {
            console.error('Link Google error:', e);
            showToast('Failed to link Google account', 'error');
        }
    });
}

// ========== LANGUAGE ==========
async function handleChangeLanguage() {
    currentLanguage = await nextLanguage(currentLanguage);
    showToast(`Language: ${LANGUAGE_NAMES[currentLanguage]}`, 'success');
}

// ========== RENDER ==========
function maskEmail(email) {
    if (!email || !email.includes('@')) return email;
    const [localPart, domain] = email.split('@');
    const visibleChars = localPart.substring(0, 3);
    return `${visibleChars}.....@${domain}`;
}

function updateMainView() {
    document.getElementById('user-email-display').textContent = userEmail || 'Guest';

    const planBadge = document.getElementById('user-plan-display');
    planBadge.textContent = userPlan;
    planBadge.classList.toggle('premium', userPlan === 'premium');

    if (activeReader) {
        document.getElementById('reader-name').textContent = activeReader.name;
        // Bundled local avatar (resolved to an extension URL)
        document.getElementById('reader-avatar').src = activeReader.avatar
            ? chrome.runtime.getURL(activeReader.avatar)
            : `https://ui-avatars.com/api/?name=${activeReader.name}&background=64b5f6&color=fff&size=100`;
    }

    // Use masked email for account settings display
    document.getElementById('account-email').textContent = maskEmail(userEmail) || 'Not set';
    document.getElementById('account-plan').textContent = userPlan;
}

// ========== MODAL HELPERS ==========
let confirmCallback = null;

function showConfirmModal(message, onConfirm) {
    const overlay = document.getElementById('modal-overlay');
    const msgEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('btn-modal-confirm');

    msgEl.textContent = message;
    confirmCallback = onConfirm;

    // Remove old listener to prevent duplicates
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

    newBtn.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        hideModal();
    });

    overlay.classList.remove('hidden');
    // Animate in
    setTimeout(() => {
        overlay.style.opacity = '1';
        overlay.querySelector('.modal-content').style.transform = 'translateY(0)';
    }, 10);
}

function hideModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.style.opacity = '0';
    overlay.querySelector('.modal-content').style.transform = 'translateY(20px)';

    setTimeout(() => {
        overlay.classList.add('hidden');
        confirmCallback = null;
    }, 200);
}

function renderReadersList(filter = '') {
    const container = document.getElementById('readers-list');
    container.innerHTML = '';

    const filtered = readers.filter(r => r.name.toLowerCase().includes(filter));

    filtered.forEach(reader => {
        const div = document.createElement('div');
        div.className = 'reader-item';
        const avatarSrc = reader.avatar
            ? chrome.runtime.getURL(reader.avatar)
            : `https://ui-avatars.com/api/?name=${reader.name}&background=random&size=40`;
        const desc = reader.description || (reader.personalityPrompt || '').substring(0, 40);
        div.innerHTML = `
      <img src="${avatarSrc}" alt="${reader.name}">
      <div class="reader-item-info">
        <div class="reader-item-name">${reader.name}</div>
        <div class="reader-item-desc">${desc}</div>
      </div>
      <span class="reader-item-plan ${reader.requiredPlan}">${reader.requiredPlan}</span>
    `;
        div.addEventListener('click', async () => {
            // Premium gating via shared pure rule (no background import).
            if (!canUseReader(userPlan, reader)) {
                showToast(`${reader.name} is a premium reader — upgrade to unlock`, 'warning');
                return;
            }

            await chrome.runtime.sendMessage({ type: MessageTypes.SET_READER, readerId: reader.id });
            activeReader = reader;
            hasSelectedReader = true;
            updateMainView();
            showView('main');
        });
        container.appendChild(div);
    });
}

// ========== START ==========
init();
