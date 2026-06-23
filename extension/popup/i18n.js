import { StorageService, StorageKeys } from '../shared/storage.js';

// In-app i18n store. chrome.i18n/_locales is locked to the browser UI locale and
// cannot be switched at runtime, so we keep a small translation table here and
// apply it to elements tagged with data-i18n / data-i18n-placeholder.

export const LANGUAGES = ['en', 'fr', 'ar'];
export const LANGUAGE_NAMES = { en: 'English', fr: 'Français', ar: 'العربية' };
const RTL_LANGUAGES = ['ar'];

const translations = {
    en: {
        tab_login: 'Login',
        tab_register: 'Register',
        label_gmail: 'GMAIL',
        label_password: 'Password',
        ph_gmail: 'Enter your Gmail',
        ph_password: 'Enter your password',
        btn_forgot: 'Forgot Password',
        btn_connect: 'Connect',
        ph_confirm_password: 'Confirm your password',
        ph_code: 'Enter the code sent to Gmail',
        btn_send_code: 'Send Code',
        btn_verify: 'Verify your email',
        btn_register: 'Register',
        btn_back_login: '← Back to Login',
        title_reset: 'Reset Password',
        btn_send_reset_code: 'Send Reset Code',
        label_new_password: 'New Password',
        ph_new_password: 'Enter new password',
        ph_confirm_new_password: 'Confirm new password',
        label_verification_code: 'Verification Code',
        ph_code_email: 'Enter code from email',
        btn_reset_password: 'Reset Password',
        ph_chat: 'Ask your reader for something...',
        history_placeholder: 'No conversation history yet',
        other_readers: 'Other Readers ...',
        hdr_select_reader: 'Select Reader',
        ph_search: 'Search your reader ...',
        hdr_settings: 'Settings',
        item_account_settings: 'Account Settings',
        btn_upgrade: 'Upgrade Your plan 💎',
        btn_logout: 'Logout',
        account_details: 'Account details',
        label_gmail_colon: 'GMAIL:',
        label_password_colon: 'Password:',
        btn_change_password: 'Change Password',
        label_current_plan: 'Current Plan:',
        btn_upgrade_inline: 'UPGRADE',
        label_linked_account: 'Linked account',
        btn_account_logout: 'Logout',
        btn_change_language: 'Change language',
        modal_title: 'Confirm Action',
        modal_cancel: 'Cancel',
        modal_confirm: 'Confirm'
    },
    fr: {
        tab_login: 'Connexion',
        tab_register: 'Inscription',
        label_gmail: 'GMAIL',
        label_password: 'Mot de passe',
        ph_gmail: 'Entrez votre Gmail',
        ph_password: 'Entrez votre mot de passe',
        btn_forgot: 'Mot de passe oublié',
        btn_connect: 'Se connecter',
        ph_confirm_password: 'Confirmez votre mot de passe',
        ph_code: 'Entrez le code envoyé sur Gmail',
        btn_send_code: 'Envoyer le code',
        btn_verify: 'Vérifier votre e-mail',
        btn_register: "S'inscrire",
        btn_back_login: '← Retour à la connexion',
        title_reset: 'Réinitialiser le mot de passe',
        btn_send_reset_code: 'Envoyer le code',
        label_new_password: 'Nouveau mot de passe',
        ph_new_password: 'Entrez le nouveau mot de passe',
        ph_confirm_new_password: 'Confirmez le nouveau mot de passe',
        label_verification_code: 'Code de vérification',
        ph_code_email: 'Entrez le code reçu par e-mail',
        btn_reset_password: 'Réinitialiser',
        ph_chat: 'Demandez quelque chose à votre lecteur...',
        history_placeholder: 'Aucun historique de conversation',
        other_readers: 'Autres lecteurs ...',
        hdr_select_reader: 'Choisir un lecteur',
        ph_search: 'Recherchez votre lecteur ...',
        hdr_settings: 'Paramètres',
        item_account_settings: 'Paramètres du compte',
        btn_upgrade: 'Améliorez votre offre 💎',
        btn_logout: 'Déconnexion',
        account_details: 'Détails du compte',
        label_gmail_colon: 'GMAIL :',
        label_password_colon: 'Mot de passe :',
        btn_change_password: 'Changer le mot de passe',
        label_current_plan: 'Offre actuelle :',
        btn_upgrade_inline: 'AMÉLIORER',
        label_linked_account: 'Compte lié',
        btn_account_logout: 'Déconnexion',
        btn_change_language: 'Changer de langue',
        modal_title: "Confirmer l'action",
        modal_cancel: 'Annuler',
        modal_confirm: 'Confirmer'
    },
    ar: {
        tab_login: 'تسجيل الدخول',
        tab_register: 'إنشاء حساب',
        label_gmail: 'جيميل',
        label_password: 'كلمة المرور',
        ph_gmail: 'أدخل بريدك في جيميل',
        ph_password: 'أدخل كلمة المرور',
        btn_forgot: 'نسيت كلمة المرور',
        btn_connect: 'اتصال',
        ph_confirm_password: 'أكد كلمة المرور',
        ph_code: 'أدخل الرمز المرسل إلى جيميل',
        btn_send_code: 'إرسال الرمز',
        btn_verify: 'تحقق من بريدك',
        btn_register: 'تسجيل',
        btn_back_login: '→ العودة لتسجيل الدخول',
        title_reset: 'إعادة تعيين كلمة المرور',
        btn_send_reset_code: 'إرسال رمز الاستعادة',
        label_new_password: 'كلمة مرور جديدة',
        ph_new_password: 'أدخل كلمة المرور الجديدة',
        ph_confirm_new_password: 'أكد كلمة المرور الجديدة',
        label_verification_code: 'رمز التحقق',
        ph_code_email: 'أدخل الرمز من البريد',
        btn_reset_password: 'إعادة التعيين',
        ph_chat: 'اطلب من القارئ شيئًا...',
        history_placeholder: 'لا يوجد سجل محادثات بعد',
        other_readers: 'قُرّاء آخرون ...',
        hdr_select_reader: 'اختر القارئ',
        ph_search: 'ابحث عن قارئك ...',
        hdr_settings: 'الإعدادات',
        item_account_settings: 'إعدادات الحساب',
        btn_upgrade: 'ترقية خطتك 💎',
        btn_logout: 'تسجيل الخروج',
        account_details: 'تفاصيل الحساب',
        label_gmail_colon: 'جيميل:',
        label_password_colon: 'كلمة المرور:',
        btn_change_password: 'تغيير كلمة المرور',
        label_current_plan: 'الخطة الحالية:',
        btn_upgrade_inline: 'ترقية',
        label_linked_account: 'الحساب المرتبط',
        btn_account_logout: 'تسجيل الخروج',
        btn_change_language: 'تغيير اللغة',
        modal_title: 'تأكيد الإجراء',
        modal_cancel: 'إلغاء',
        modal_confirm: 'تأكيد'
    }
};

export function applyLanguage(lang) {
    const dict = translations[lang] || translations.en;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key] !== undefined) el.textContent = dict[key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (dict[key] !== undefined) el.placeholder = dict[key];
    });

    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr';
}

export async function getStoredLanguage() {
    return (await StorageService.get(StorageKeys.LANGUAGE)) || 'en';
}

export async function setStoredLanguage(lang) {
    await StorageService.set(StorageKeys.LANGUAGE, lang);
}

// Load + apply the persisted language. Returns the active language code.
export async function initLanguage() {
    const lang = await getStoredLanguage();
    applyLanguage(lang);
    return lang;
}

// Cycle to the next language, persist it, apply it. Returns the new language code.
export async function nextLanguage(current) {
    const idx = LANGUAGES.indexOf(current);
    const next = LANGUAGES[(idx + 1) % LANGUAGES.length];
    await setStoredLanguage(next);
    applyLanguage(next);
    return next;
}
