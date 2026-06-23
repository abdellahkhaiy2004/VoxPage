// VoxPage Admin dashboard — vanilla JS, talks to the same backend as the extension.
// Same-origin: the page is served from the backend, so relative URLs hit it directly.

const TOKEN_KEY = 'voxpage_admin_token';
const EMAIL_KEY = 'voxpage_admin_email';

const $ = (id) => document.getElementById(id);

function token() { return localStorage.getItem(TOKEN_KEY); }

async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token() ? { Authorization: `Bearer ${token()}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    let data = {};
    try { data = await res.json(); } catch { /* ignore non-JSON */ }
    if (res.status === 401 || res.status === 403) {
        // Token expired/banned/lost admin -> bounce to login (unless it's a login attempt).
        if (!path.startsWith('/auth/login')) { logout(); }
    }
    return { ok: res.ok, status: res.status, data };
}

function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    setTimeout(() => t.classList.add('hidden'), 2600);
    t.classList.remove('hidden');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Auth ----------
function showLogin() {
    $('view-login').classList.remove('hidden');
    $('view-dashboard').classList.add('hidden');
}
function showDashboard() {
    $('view-login').classList.add('hidden');
    $('view-dashboard').classList.remove('hidden');
    $('admin-email').textContent = localStorage.getItem(EMAIL_KEY) || '';
    loadStats();
    loadUsers();
    loadReaders();
}
function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    showLogin();
}

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    err.classList.add('hidden');
    const btn = $('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';

    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    const { data } = await api('/auth/login', { method: 'POST', body: { email, password } });

    btn.disabled = false; btn.textContent = 'Sign in';

    if (!data.success) {
        err.textContent = data.error || 'Login failed.';
        err.classList.remove('hidden');
        return;
    }
    if (!data.is_admin) {
        err.textContent = 'This account is not an admin.';
        err.classList.remove('hidden');
        return;
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(EMAIL_KEY, email);
    showDashboard();
});

$('logout-btn').addEventListener('click', logout);

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        $('tab-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'settings' && !envLoaded) loadEnv();
    });
});

// ---------- Stats ----------
async function loadStats() {
    const { data } = await api('/admin/stats');
    if (!data.success) return;
    const s = data.stats;
    $('stats').innerHTML = [
        ['Total users', s.total_users],
        ['Premium', s.premium_users],
        ['Verified', s.verified_users],
        ['Banned', s.banned_users]
    ].map(([label, num]) => `
        <div class="stat-card"><div class="num">${num}</div><div class="label">${label}</div></div>
    `).join('');
}

// ---------- Users ----------
async function loadUsers() {
    const { data } = await api('/admin/users');
    if (!data.success) return;
    const body = $('users-body');
    $('users-empty').classList.toggle('hidden', data.users.length > 0);
    body.innerHTML = data.users.map(renderUserRow).join('');
}

function renderUserRow(u) {
    const status = u.banned
        ? '<span class="badge badge-banned">banned</span>'
        : (u.is_admin ? '<span class="badge badge-admin">admin</span>'
                      : '<span class="badge badge-active">active</span>');
    const joined = new Date(u.created_at).toLocaleDateString();
    const planSelect = `
        <select class="plan-select" data-id="${u.id}" ${u.is_admin ? '' : ''}>
            <option value="free" ${u.plan === 'free' ? 'selected' : ''}>free</option>
            <option value="premium" ${u.plan === 'premium' ? 'selected' : ''}>premium</option>
        </select>`;
    let action = '';
    if (u.is_admin) {
        action = '<span class="badge badge-admin">protected</span>';
    } else if (u.banned) {
        action = `<button class="btn btn-success btn-sm" data-act="unban" data-id="${u.id}">Unban</button>`;
    } else {
        action = `<button class="btn btn-danger btn-sm" data-act="ban" data-id="${u.id}">Ban</button>`;
    }
    return `<tr>
        <td>${escapeHtml(u.email)}</td>
        <td>${planSelect}</td>
        <td>${status}</td>
        <td>${u.reads_today}</td>
        <td>${joined}</td>
        <td class="cell-actions">${action}</td>
    </tr>`;
}

$('users-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'ban' && !confirm('Ban this user? They will be logged out and blocked.')) return;
    const { data } = await api(`/admin/users/${id}/${act}`, { method: 'POST' });
    if (data.success) { toast(act === 'ban' ? 'User banned' : 'User unbanned'); loadUsers(); loadStats(); }
    else toast(data.error || 'Action failed', true);
});

$('users-body').addEventListener('change', async (e) => {
    const sel = e.target.closest('.plan-select');
    if (!sel) return;
    const { data } = await api(`/admin/users/${sel.dataset.id}/plan`, { method: 'POST', body: { plan: sel.value } });
    if (data.success) { toast(`Plan set to ${data.plan}`); loadStats(); }
    else { toast(data.error || 'Could not change plan', true); loadUsers(); }
});

$('refresh-users').addEventListener('click', () => { loadUsers(); loadStats(); });

// ---------- Readers ----------
async function loadReaders() {
    const { data } = await api('/admin/readers');
    if (!data.success) return;
    $('readers-body').innerHTML = data.readers.map(renderReaderRow).join('');
}

function renderReaderRow(r) {
    const plan = r.required_plan === 'premium'
        ? '<span class="badge badge-premium">premium</span>'
        : '<span class="badge badge-free">free</span>';
    const enabled = r.enabled
        ? '<span class="badge badge-active">yes</span>'
        : '<span class="badge badge-banned">no</span>';
    return `<tr>
        <td class="avatar-cell">${r.avatar ? `<img src="" alt="${escapeHtml(r.name)}">` : '🎙️'}</td>
        <td>${escapeHtml(r.name)}</td>
        <td><code>${escapeHtml(r.slug)}</code></td>
        <td>${plan}</td>
        <td><code>${escapeHtml(r.elevenlabs_voice_id)}</code></td>
        <td>${enabled}</td>
        <td class="cell-actions">
            <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-act="delete" data-id="${r.id}">Delete</button>
        </td>
    </tr>`;
}

let readersCache = [];
async function refreshReadersCache() {
    const { data } = await api('/admin/readers');
    readersCache = data.success ? data.readers : [];
    return readersCache;
}

// Modal helpers
function openReaderModal(reader) {
    $('reader-error').classList.add('hidden');
    $('reader-modal-title').textContent = reader ? 'Edit reader' : 'New reader';
    $('reader-id').value = reader ? reader.id : '';
    $('reader-name').value = reader ? reader.name : '';
    $('reader-slug').value = reader ? reader.slug : '';
    $('reader-description').value = reader ? reader.description : '';
    $('reader-personality').value = reader ? reader.personality_prompt : '';
    $('reader-voice').value = reader ? reader.elevenlabs_voice_id : '';
    $('reader-avatar').value = reader ? reader.avatar : '';
    $('reader-plan').value = reader ? reader.required_plan : 'free';
    $('reader-enabled').checked = reader ? reader.enabled : true;
    $('reader-modal').classList.remove('hidden');
}
function closeReaderModal() { $('reader-modal').classList.add('hidden'); }

$('new-reader').addEventListener('click', () => openReaderModal(null));
$('reader-cancel').addEventListener('click', closeReaderModal);

$('readers-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'edit') {
        const list = await refreshReadersCache();
        const reader = list.find((r) => r.id === id);
        if (reader) openReaderModal(reader);
    } else if (act === 'delete') {
        if (!confirm('Delete this reader? Users will no longer be able to select it.')) return;
        const { data } = await api(`/admin/readers/${id}`, { method: 'DELETE' });
        if (data.success) { toast('Reader deleted'); loadReaders(); }
        else toast(data.error || 'Delete failed', true);
    }
});

$('reader-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('reader-error');
    err.classList.add('hidden');
    const id = $('reader-id').value;
    const payload = {
        name: $('reader-name').value.trim(),
        slug: $('reader-slug').value.trim(),
        description: $('reader-description').value.trim(),
        personality_prompt: $('reader-personality').value.trim(),
        elevenlabs_voice_id: $('reader-voice').value.trim(),
        avatar: $('reader-avatar').value.trim(),
        required_plan: $('reader-plan').value,
        enabled: $('reader-enabled').checked
    };
    const { data } = id
        ? await api(`/admin/readers/${id}`, { method: 'PUT', body: payload })
        : await api('/admin/readers', { method: 'POST', body: payload });
    if (data.success) { closeReaderModal(); toast('Reader saved'); loadReaders(); }
    else { err.textContent = data.error || 'Save failed'; err.classList.remove('hidden'); }
});

// ---------- Settings (.env) ----------
let envLoaded = false;
// Original values, so we only send what actually changed.
const envOriginal = new Map();

// High-risk keys: editing these can break login or the next boot.
function isRiskyKey(key) {
    return /^DB_/.test(key) || key === 'JWT_SECRET' || key === 'PORT' || /^ADMIN_/.test(key);
}

async function loadEnv() {
    const { data } = await api('/admin/env');
    if (!data.success) { toast(data.error || 'Could not load settings', true); return; }
    envOriginal.clear();
    const container = $('env-sections');
    container.innerHTML = data.sections.map(renderEnvSection).join('');
    envLoaded = true;
    updateEnvSaveState();
}

function renderEnvSection(section) {
    const rows = section.vars.map(renderEnvRow).join('');
    const desc = section.description
        ? `<div class="env-section-desc">${escapeHtml(section.description)}</div>` : '';
    return `<div class="env-section">
        <div class="env-section-head">${escapeHtml(section.name)}</div>
        ${desc}
        ${rows}
    </div>`;
}

function renderEnvRow(v) {
    envOriginal.set(v.key, v.value);
    const risky = isRiskyKey(v.key);
    const riskBadge = risky ? '<span class="risk-badge">risky</span>' : '';
    const comment = v.comment ? `<span class="key-comment">${escapeHtml(v.comment)}</span>` : '';
    const reveal = v.masked
        ? `<button type="button" class="reveal-btn" data-reveal title="Show/hide">👁</button>` : '';
    return `<div class="env-row" data-key="${escapeHtml(v.key)}">
        <div class="env-key">${escapeHtml(v.key)}${riskBadge}${comment}</div>
        <div class="env-input-wrap">
            <input class="env-input${risky ? ' risky' : ''}" type="${v.masked ? 'password' : 'text'}"
                   value="${escapeHtml(v.value)}" data-key="${escapeHtml(v.key)}">
            ${reveal}
        </div>
        <span></span>
    </div>`;
}

// Collect only the variables whose value differs from what was loaded.
function dirtyEnvUpdates() {
    const updates = {};
    document.querySelectorAll('#env-sections .env-input').forEach((inp) => {
        const key = inp.dataset.key;
        const val = inp.value;
        if (!envOriginal.has(key) || envOriginal.get(key) !== val) {
            updates[key] = val;
        }
    });
    return updates;
}

function updateEnvSaveState() {
    const updates = dirtyEnvUpdates();
    const n = Object.keys(updates).length;
    $('env-save').disabled = n === 0;
    $('env-save').textContent = n ? `Save changes (${n})` : 'Save changes';
}

// Mark inputs dirty + toggle save button as the admin types.
$('env-sections').addEventListener('input', (e) => {
    const inp = e.target.closest('.env-input');
    if (!inp) return;
    const changed = !envOriginal.has(inp.dataset.key) || envOriginal.get(inp.dataset.key) !== inp.value;
    inp.classList.toggle('dirty', changed);
    updateEnvSaveState();
});

// Reveal/hide a secret value; delete a row.
$('env-sections').addEventListener('click', (e) => {
    const reveal = e.target.closest('[data-reveal]');
    if (reveal) {
        const inp = reveal.closest('.env-input-wrap').querySelector('.env-input');
        inp.type = inp.type === 'password' ? 'text' : 'password';
        return;
    }
    // Delete only exists on newly-added (unsaved) rows — it just cancels the add.
    const del = e.target.closest('[data-del]');
    if (del) {
        del.closest('.env-section').remove();
        updateEnvSaveState();
    }
});

// Add a blank variable row at the top.
$('env-add').addEventListener('click', () => {
    const key = prompt('New variable name (e.g. MY_FLAG):');
    if (!key) return;
    const trimmed = key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) { toast('Invalid variable name', true); return; }
    if (envOriginal.has(trimmed) || document.querySelector(`.env-input[data-key="${trimmed}"]`)) {
        toast('That variable already exists', true); return;
    }
    const html = `<div class="env-section"><div class="env-section-head">New</div>
        <div class="env-row" data-key="${escapeHtml(trimmed)}">
            <div class="env-key">${escapeHtml(trimmed)}</div>
            <div class="env-input-wrap">
                <input class="env-input dirty" type="text" value="" data-key="${escapeHtml(trimmed)}">
            </div>
            <button type="button" class="btn btn-ghost btn-sm env-del" data-del>✕</button>
        </div></div>`;
    $('env-sections').insertAdjacentHTML('afterbegin', html);
    updateEnvSaveState();
});

$('env-refresh').addEventListener('click', loadEnv);

$('env-save').addEventListener('click', async () => {
    const updates = dirtyEnvUpdates();
    const keys = Object.keys(updates);
    if (!keys.length) return;
    const risky = keys.filter(isRiskyKey);
    if (risky.length && !confirm(
        `You are changing risky variable(s): ${risky.join(', ')}.\n\n` +
        `A wrong value can break login or stop the server from booting. Continue?`)) {
        return;
    }
    const { data } = await api('/admin/env', { method: 'PUT', body: { updates } });
    if (data.success) {
        toast(`Saved ${data.changed.length} variable(s). Restart the server to apply.`);
        loadEnv();
    } else {
        toast(data.error || 'Save failed', true);
    }
});

// ---------- Boot ----------
if (token()) showDashboard(); else showLogin();
