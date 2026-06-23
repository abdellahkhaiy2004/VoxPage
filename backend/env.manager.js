// Read/write helpers for backend/.env, used by the admin Settings panel.
// Parsing preserves the file's comment "sections" so the UI can group variables,
// and writes update values in place while keeping comments/formatting intact.
import fs from 'fs';

// Keys whose values should be masked in the UI (and never logged).
// The (?!S) guard avoids false positives like GEMINI_MAX_OUTPUT_TOKENS.
const SECRET_RE = /(PASS(WORD)?|SECRET|API_KEY|TOKEN)(?!S)/i;

export function isSecretKey(key) {
    return SECRET_RE.test(key);
}

function isValidKey(key) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

// Locate an inline comment ("KEY=value   # note"), ignoring '#' inside quotes.
function findInlineComment(s) {
    let inQuote = false, quote = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuote) {
            if (c === quote) inQuote = false;
        } else if (c === '"' || c === "'") {
            inQuote = true; quote = c;
        } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
            return i;
        }
    }
    return -1;
}

function unquote(v) {
    const t = v.trim();
    if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
        return t.slice(1, -1);
    }
    return t;
}

// Quote a value only when it needs it (whitespace, '#', or surrounding quotes).
function formatValue(v) {
    const s = String(v ?? '');
    if (s === '') return '';
    if (/[\s#]/.test(s) || /^['"]/.test(s)) {
        return `"${s.replace(/"/g, '\\"')}"`;
    }
    return s;
}

// Parse .env content into grouped sections for the UI.
// A comment line that starts a block becomes the section name; following comment
// lines in the same block are folded into the section description.
export function parseEnv(content) {
    const lines = content.split(/\r?\n/);
    const sections = [];
    let current = { name: 'General', description: '', vars: [] };
    sections.push(current);
    let prevWasComment = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { prevWasComment = false; continue; }

        if (trimmed.startsWith('#')) {
            const text = trimmed.replace(/^#+\s?/, '');
            if (!prevWasComment) {
                current = { name: text, description: '', vars: [] };
                sections.push(current);
            } else {
                current.description += (current.description ? ' ' : '') + text;
            }
            prevWasComment = true;
            continue;
        }

        prevWasComment = false;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        if (!isValidKey(key)) continue;

        const rest = line.slice(eq + 1);
        const hashIdx = findInlineComment(rest);
        const comment = hashIdx !== -1 ? rest.slice(hashIdx + 1).trim() : '';
        const rawValue = hashIdx !== -1 ? rest.slice(0, hashIdx) : rest;
        const value = unquote(rawValue);
        const secret = isSecretKey(key);

        current.vars.push({
            key,
            value,                 // real value (admin is authenticated)
            masked: secret,        // UI hides by default when true
            comment
        });
    }

    return sections.filter(s => s.vars.length > 0);
}

export function readEnvSections(envPath) {
    const content = fs.readFileSync(envPath, 'utf8');
    return parseEnv(content);
}

// Apply { KEY: value } updates to the .env file, preserving comments and order.
// Existing keys are updated in place; brand-new keys are appended. Returns the
// list of keys actually changed. Also mirrors updates into process.env.
export function writeEnvUpdates(envPath, updates) {
    for (const key of Object.keys(updates)) {
        if (!isValidKey(key)) {
            throw new Error(`Invalid variable name: ${key}`);
        }
    }

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const seen = new Set();
    const changed = [];

    const out = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const eq = line.indexOf('=');
        if (eq === -1) return line;
        const key = line.slice(0, eq).trim();
        if (!(key in updates)) return line;

        seen.add(key);
        const rest = line.slice(eq + 1);
        const hashIdx = findInlineComment(rest);
        const inlineComment = hashIdx !== -1 ? rest.slice(hashIdx) : '';
        const oldValue = unquote(hashIdx !== -1 ? rest.slice(0, hashIdx) : rest);
        if (oldValue !== String(updates[key] ?? '')) changed.push(key);

        const newVal = formatValue(updates[key]);
        return `${key}=${newVal}${inlineComment ? '   ' + inlineComment.trim() : ''}`;
    });

    const newKeys = Object.keys(updates).filter(k => !seen.has(k));
    if (newKeys.length) {
        out.push('');
        out.push('# Added via admin Settings panel');
        for (const k of newKeys) {
            out.push(`${k}=${formatValue(updates[k])}`);
            changed.push(k);
        }
    }

    fs.writeFileSync(envPath, out.join('\n'), 'utf8');

    // Reflect changes into the running process (full effect still needs a restart).
    for (const [k, v] of Object.entries(updates)) process.env[k] = String(v ?? '');

    return changed;
}
