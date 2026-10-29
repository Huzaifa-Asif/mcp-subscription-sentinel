import assert from 'node:assert/strict'; import test from 'node:test'; import api from '../dist/index.js';
const { createSubscriptionState, transitionSubscription } = api; const options = { staleAfterMs: 1000, baseDelayMs: 100, maxDelayMs: 400, maxAttempts: 3 };
test('opens a numbered generation', () => { const r = transitionSubscription(createSubscriptionState(), { type: 'open-requested', at: 0 }, options); assert.equal(r.state.generation, 1); assert.deepEqual(r.action, { type: 'open', generation: 1 }); });
test('activity refreshes only the active generation', () => { let s = transitionSubscription(createSubscriptionState(), { type: 'open-requested', at: 0 }, options).state; s = transitionSubscription(s, { type: 'opened', at: 5, generation: 1 }, options).state; const old = transitionSubscription(s, { type: 'activity', at: 8, generation: 0 }, options); assert.equal(old.ignored, true); assert.equal(old.state.lastActivityAt, 5); });
test('stale open subscription enters bounded wait and reopens', () => { let s = transitionSubscription(createSubscriptionState(), { type: 'open-requested', at: 0 }, options).state; s = transitionSubscription(s, { type: 'opened', at: 5, generation: 1 }, options).state; let r = transitionSubscription(s, { type: 'tick', at: 1005 }, options); assert.equal(r.state.nextAttemptAt, 1105); r = transitionSubscription(r.state, { type: 'tick', at: 1105 }, options); assert.deepEqual(r.action, { type: 'open', generation: 2, reason: 'stale' }); });
test('backoff doubles and stops after the limit', () => { const s = Object.freeze({ phase: 'open', generation: 1, attempt: 2, lastActivityAt: 0 }); const r = transitionSubscription(s, { type: 'failed', at: 10, generation: 1 }, options); assert.equal(r.state.nextAttemptAt, 410); const stopped = transitionSubscription({ ...r.state, phase: 'open' }, { type: 'failed', at: 500, generation: 1 }, options); assert.equal(stopped.action.type, 'stop'); });
test('reset permits a deliberate restart after stop', () => { const stopped = { phase: 'stopped', generation: 2, attempt: 3 }; const r = transitionSubscription(stopped, { type: 'reset', at: 20 }, options); assert.equal(r.state.phase, 'idle'); assert.equal(r.state.generation, 2); });
test('validates time and retry bounds', () => { assert.throws(() => transitionSubscription(createSubscriptionState(), { type: 'tick', at: -1 }, options), RangeError); assert.throws(() => transitionSubscription(createSubscriptionState(), { type: 'tick', at: 0 }, { staleAfterMs: 0 }), RangeError); });
test('ignores invalid-phase lifecycle events and duplicate failures', () => {
  const idle = createSubscriptionState(); assert.equal(transitionSubscription(idle, { type: 'opened', at: 1, generation: 0 }, options).ignored, true); assert.equal(transitionSubscription(idle, { type: 'failed', at: 1, generation: 0 }, options).ignored, true);
  const waiting = transitionSubscription({ phase: 'opening', generation: 1, attempt: 0, lastActivityAt: 0 }, { type: 'failed', at: 5, generation: 1 }, options).state;
  const duplicate = transitionSubscription(waiting, { type: 'failed', at: 6, generation: 1 }, options); assert.equal(duplicate.ignored, true); assert.equal(duplicate.state.attempt, 1);
  assert.equal(transitionSubscription(waiting, { type: 'opened', at: 7, generation: 1 }, options).ignored, true);
});
test('times out an opening attempt', () => {
  const opening = transitionSubscription(createSubscriptionState(), { type: 'open-requested', at: 0 }, options).state;
  const result = transitionSubscription(opening, { type: 'tick', at: 1000 }, options); assert.equal(result.state.phase, 'waiting'); assert.equal(result.state.reason, 'open-timeout');
});
test('rejects unsafe derived timestamps and generations', () => {
  assert.throws(() => transitionSubscription({ phase: 'open', generation: 1, attempt: 0, lastActivityAt: 0 }, { type: 'failed', at: Number.MAX_SAFE_INTEGER, generation: 1 }, options), RangeError);
  assert.throws(() => transitionSubscription({ phase: 'idle', generation: Number.MAX_SAFE_INTEGER, attempt: 0 }, { type: 'open-requested', at: 0 }, options), RangeError);
});
test('does not let a manual open request bypass scheduled backoff', () => {
  const waiting = { phase: 'waiting', generation: 1, attempt: 1, nextAttemptAt: 100, reason: 'failed' };
  const result = transitionSubscription(waiting, { type: 'open-requested', at: 50 }, options); assert.equal(result.ignored, true); assert.equal(result.state.nextAttemptAt, 100);
});
