// Strategy: encapsulates an AI reader's behavior (persona + voice).
// This is the "AIReader (strategy)" from the component diagram — services ask the
// strategy for persona/voice instead of reaching into raw reader fields.
export class ReaderStrategy {
    constructor(reader) {
        this.reader = reader;
    }

    get id() { return this.reader.id; }
    get name() { return this.reader.name; }

    getPersona() {
        return this.reader.personalityPrompt;
    }

    getVoiceId() {
        return this.reader.voiceId;
    }

    requiresPremium() {
        return this.reader.requiredPlan === 'premium';
    }
}
