// Strategy: client-side plan behavior, used for UI gating hints. The backend
// (backend/plan.strategy.js) remains the authoritative enforcer; this just lets
// the popup decide what to show/allow without inline `plan === 'premium'` checks.
export class PlanStrategy {
    constructor(plan) {
        this.plan = plan === 'premium' ? 'premium' : 'free';
    }

    isPremium() {
        return this.plan === 'premium';
    }

    // Can the current plan select this reader?
    canUseReader(readerStrategy) {
        return this.isPremium() || !readerStrategy.requiresPremium();
    }
}

export function getPlanStrategy(plan) {
    return new PlanStrategy(plan);
}
