import { StorageService, StorageKeys } from '../shared/storage.js';

const API_URL = 'http://localhost:3000/auth';
const BASE_URL = 'http://localhost:3000';

export class AuthService {

    // --- HELPERS ---
    async _post(endpoint, body) {
        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            return await response.json();
        } catch (error) {
            console.error(`[Auth] API Error ${endpoint}:`, error);
            return { success: false, error: 'Network error or Server offline' };
        }
    }

    // --- PUBLIC API ---

    // 1. REGISTER
    async register(email, password) {
        const result = await this._post('/register', { email, password });
        if (result.success) {
            await StorageService.set('auth_state', {
                status: 'AWAITING_VERIFICATION',
                email: email,
                timestamp: Date.now()
            });
        }
        return result;
    }

    // 1.5 RESEND CODE
    async resendCode(email) {
        return await this._post('/resend', { email });
    }

    // 2. VERIFY EMAIL
    async verifyEmail(code) {
        // Note: The Server currently expects { code, email }. 
        // We need to retrieve the email from 'pending state' if the UI doesn't pass it.
        // Ideally, the UI flow should pass the email. 
        // For now, let's assume the UI or state handling passes it.
        // If 'code' is the only arg from message context, we might need to store the email temporarily.

        // Check if we have a pending email in storage
        const authState = await this.getAuthState();
        if (!authState || !authState.email) {
            return { success: false, error: 'No pending verification context found.' };
        }

        const result = await this._post('/verify', { code, email: authState.email });

        if (result.success) {
            // Clear local pending state
            await StorageService.remove('auth_state');
        }
        return result;
    }

    // 3. LOGIN
    async login(email, password) {
        const result = await this._post('/login', { email, password });

        if (result.success) {
            // Save Session with email
            await this._setSession(result.token, result.plan, email);
        } else if (result.requiresVerification) {
            // Local state used by Popup to show "Verify UI"
            await StorageService.set('auth_state', {
                status: 'AWAITING_VERIFICATION',
                email: email,
                timestamp: Date.now()
            });
        }

        return result;
    }

    // 4. SESSION & STATE
    async _setSession(token, plan, email) {
        await StorageService.set(StorageKeys.TOKEN, token);
        await StorageService.set(StorageKeys.PLAN, plan);
        await StorageService.set(StorageKeys.EMAIL, email);
    }

    async isLoggedIn() {
        const token = await StorageService.get(StorageKeys.TOKEN);
        return !!token;
    }

    async getSession() {
        const token = await StorageService.get(StorageKeys.TOKEN);
        const plan = await StorageService.get(StorageKeys.PLAN);
        const email = await StorageService.get(StorageKeys.EMAIL);
        return { token, plan, email, isLoggedIn: !!token };
    }

    async logout() {
        await StorageService.remove(StorageKeys.TOKEN);
        await StorageService.remove(StorageKeys.PLAN);
        await StorageService.remove(StorageKeys.EMAIL);
        await StorageService.remove('auth_state');
        return { success: true };
    }

    async getAuthState() {
        return await StorageService.get('auth_state');
    }

    async getPlan() {
        // Check if we have a token (simple check)
        const token = await StorageService.get(StorageKeys.TOKEN);
        if (!token) return 'free'; // Guest/Logged out

        const plan = await StorageService.get(StorageKeys.PLAN);
        return plan || 'free';
    }

    // 4.5 PLAN — fetch authoritative plan from backend and cache it
    async getUserPlan() {
        const token = await StorageService.get(StorageKeys.TOKEN);
        if (!token) return { success: false, error: 'Not logged in' };
        try {
            const response = await fetch(`${BASE_URL}/plan`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.success && data.plan) {
                await StorageService.set(StorageKeys.PLAN, data.plan);
            }
            return data;
        } catch (error) {
            console.error('[Auth] getUserPlan error:', error);
            return { success: false, error: 'Network error or Server offline' };
        }
    }

    // 4.6 UPGRADE — flip the account to premium, then refresh the cached plan
    async upgradePlan() {
        const token = await StorageService.get(StorageKeys.TOKEN);
        if (!token) return { success: false, error: 'Not logged in' };
        try {
            const response = await fetch(`${BASE_URL}/upgrade`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            if (data.success && data.plan) {
                await StorageService.set(StorageKeys.PLAN, data.plan);
            }
            return data;
        } catch (error) {
            console.error('[Auth] upgradePlan error:', error);
            return { success: false, error: 'Network error or Server offline' };
        }
    }

    // 4.7 GOOGLE LINKING — send the Google token to the backend to link
    async linkGoogle(googleToken) {
        const token = await StorageService.get(StorageKeys.TOKEN);
        if (!token) return { success: false, error: 'Not logged in' };
        try {
            const response = await fetch(`${API_URL}/link-google`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: googleToken })
            });
            return await response.json();
        } catch (error) {
            console.error('[Auth] linkGoogle error:', error);
            return { success: false, error: 'Network error or Server offline' };
        }
    }

    // 4.8 LINK STATUS — which external providers are linked
    async getLinkStatus() {
        const token = await StorageService.get(StorageKeys.TOKEN);
        if (!token) return { success: false, error: 'Not logged in' };
        try {
            const response = await fetch(`${API_URL}/link-status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return await response.json();
        } catch (error) {
            console.error('[Auth] getLinkStatus error:', error);
            return { success: false, error: 'Network error or Server offline' };
        }
    }

    // 5. FORGOT PASSWORD - Request reset code
    async forgotPassword(email) {
        return await this._post('/forgot-password', { email });
    }

    // 6. RESET PASSWORD - Submit new password with code
    async resetPassword(email, code, newPassword) {
        return await this._post('/reset-password', { email, code, newPassword });
    }
}
