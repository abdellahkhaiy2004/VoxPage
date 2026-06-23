// Pure plan rules shared by UI and (optionally) background — no chrome.* / no DOM.
// Keeps the popup from importing background-context modules.

export function isPremium(plan) {
    return plan === 'premium';
}

// Can a user on `plan` select `reader`? Free users can't pick premium readers.
export function canUseReader(plan, reader) {
    if (!reader || reader.requiredPlan !== 'premium') return true;
    return isPremium(plan);
}
