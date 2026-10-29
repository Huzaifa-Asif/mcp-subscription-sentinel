export interface SentinelOptions { staleAfterMs: number; baseDelayMs?: number; maxDelayMs?: number; maxAttempts?: number; }
export interface SubscriptionState { phase: 'idle' | 'opening' | 'open' | 'waiting' | 'stopped'; generation: number; lastActivityAt?: number; attempt: number; nextAttemptAt?: number; reason?: string; }
export type SubscriptionEvent =
  | { type: 'open-requested'; at: number }
  | { type: 'opened'; at: number; generation: number }
  | { type: 'activity'; at: number; generation: number }
  | { type: 'closed' | 'failed'; at: number; generation: number; reason?: string }
  | { type: 'tick'; at: number }
  | { type: 'reset'; at: number }
  | { type: 'stop'; at: number; reason?: string };
export interface TransitionResult { state: Readonly<SubscriptionState>; action: Readonly<{ type: 'none' | 'open' | 'stop'; generation?: number; reason?: string }>; ignored: boolean; }

function safeTime(value: number, name: string): void { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`); }
function optionsOf(options: SentinelOptions) {
  safeTime(options.staleAfterMs, 'staleAfterMs'); if (options.staleAfterMs === 0) throw new RangeError('staleAfterMs must be greater than zero');
  const baseDelayMs = options.baseDelayMs ?? 1000; const maxDelayMs = options.maxDelayMs ?? 30000; const maxAttempts = options.maxAttempts ?? 5;
  safeTime(baseDelayMs, 'baseDelayMs'); safeTime(maxDelayMs, 'maxDelayMs'); safeTime(maxAttempts, 'maxAttempts');
  if (baseDelayMs === 0 || maxDelayMs < baseDelayMs || maxAttempts === 0) throw new RangeError('retry bounds are invalid');
  return { staleAfterMs: options.staleAfterMs, baseDelayMs, maxDelayMs, maxAttempts };
}
function frozen(state: SubscriptionState, action: TransitionResult['action'], ignored = false): TransitionResult { return Object.freeze({ state: Object.freeze(state), action: Object.freeze(action), ignored }); }
function increment(value: number, name: string): number { const next = value + 1; if (!Number.isSafeInteger(next)) throw new RangeError(`${name} exceeds Number.MAX_SAFE_INTEGER`); return next; }
function addTime(at: number, delay: number): number { const next = at + delay; if (!Number.isSafeInteger(next)) throw new RangeError('derived retry timestamp exceeds Number.MAX_SAFE_INTEGER'); return next; }
function retry(state: SubscriptionState, at: number, reason: string, options: ReturnType<typeof optionsOf>): TransitionResult {
  const attempt = increment(state.attempt, 'attempt');
  if (attempt > options.maxAttempts) return frozen({ ...state, phase: 'stopped', reason, nextAttemptAt: undefined }, { type: 'stop', reason: `retry-limit:${reason}` });
  const delay = Math.min(options.maxDelayMs, options.baseDelayMs * (2 ** (attempt - 1)));
  return frozen({ ...state, phase: 'waiting', attempt, nextAttemptAt: addTime(at, delay), reason }, { type: 'none' });
}

export function createSubscriptionState(): Readonly<SubscriptionState> { return Object.freeze({ phase: 'idle', generation: 0, attempt: 0 }); }

export function transitionSubscription(current: Readonly<SubscriptionState>, event: SubscriptionEvent, rawOptions: SentinelOptions): TransitionResult {
  const options = optionsOf(rawOptions); safeTime(event.at, 'event.at'); const state = { ...current };
  if (event.type === 'reset') return frozen({ phase: 'idle', generation: state.generation, attempt: 0 }, { type: 'none' });
  if (event.type === 'stop') return frozen({ ...state, phase: 'stopped', nextAttemptAt: undefined, reason: event.reason }, { type: 'stop', reason: event.reason });
  if (state.phase === 'stopped') return frozen(state, { type: 'none' }, true);
  if (event.type === 'open-requested') {
    if (state.phase !== 'idle') return frozen(state, { type: 'none' }, true);
    const generation = increment(state.generation, 'generation');
    return frozen({ phase: 'opening', generation, attempt: state.attempt, lastActivityAt: event.at }, { type: 'open', generation });
  }
  if ('generation' in event && event.generation !== state.generation) return frozen(state, { type: 'none' }, true);
  if (event.type === 'opened') {
    if (state.phase !== 'opening') return frozen(state, { type: 'none' }, true);
    return frozen({ phase: 'open', generation: state.generation, attempt: 0, lastActivityAt: event.at }, { type: 'none' });
  }
  if (event.type === 'activity') {
    if (state.phase !== 'open') return frozen(state, { type: 'none' }, true);
    return frozen({ ...state, lastActivityAt: Math.max(state.lastActivityAt ?? 0, event.at) }, { type: 'none' });
  }
  if (event.type === 'closed' || event.type === 'failed') {
    if (state.phase !== 'opening' && state.phase !== 'open') return frozen(state, { type: 'none' }, true);
    return retry(state, event.at, event.reason ?? event.type, options);
  }
  if (event.type === 'tick') {
    if (state.phase === 'open' && state.lastActivityAt !== undefined && event.at - state.lastActivityAt >= options.staleAfterMs) return retry(state, event.at, 'stale', options);
    if (state.phase === 'opening' && state.lastActivityAt !== undefined && event.at - state.lastActivityAt >= options.staleAfterMs) return retry(state, event.at, 'open-timeout', options);
    if (state.phase === 'waiting' && state.nextAttemptAt !== undefined && event.at >= state.nextAttemptAt) {
      const generation = increment(state.generation, 'generation');
      return frozen({ ...state, phase: 'opening', generation, lastActivityAt: event.at, nextAttemptAt: undefined }, { type: 'open', generation, reason: state.reason });
    }
  }
  return frozen(state, { type: 'none' });
}
