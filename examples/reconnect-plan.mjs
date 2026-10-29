import { createSubscriptionState, transitionSubscription } from 'mcp-subscription-sentinel';
const options = { staleAfterMs: 30_000, baseDelayMs: 1_000, maxDelayMs: 30_000, maxAttempts: 5 };
let state = createSubscriptionState();
({ state } = transitionSubscription(state, { type: 'open-requested', at: 0 }, options));
({ state } = transitionSubscription(state, { type: 'opened', at: 10, generation: 1 }, options));
const result = transitionSubscription(state, { type: 'tick', at: 30_010 }, options);
console.log(JSON.stringify(result, null, 2));
