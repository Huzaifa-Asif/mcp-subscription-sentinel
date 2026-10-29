# mcp-subscription-sentinel

A dependency-free pure state machine for MCP clients that need to notice a silent or stale long-lived subscription and schedule bounded reconnect attempts without accepting late events from an older connection.

## Why

An MCP client can keep serving a stale catalog after a `subscriptions/listen` stream closes or stops delivering list-change events. Transport libraries reconnect sockets, but applications still need explicit lifecycle state, generation fencing, retry budgets, and a decision about when to stop. This package plans those transitions; it does not own the network.

```js
import { createSubscriptionState, transitionSubscription } from 'mcp-subscription-sentinel';

const options = { staleAfterMs: 30_000, baseDelayMs: 1_000, maxDelayMs: 30_000, maxAttempts: 5 };
let state = createSubscriptionState();
let result = transitionSubscription(state, { type: 'open-requested', at: Date.now() }, options);
state = result.state;
// When action.type is "open", open the subscription and tag callbacks with action.generation.
```

## API and transition contract

`createSubscriptionState()` returns immutable idle state. `transitionSubscription(state, event, options)` returns `{ state, action, ignored }`.

- `open-requested` allocates a new generation and emits `open`.
- `opened` is accepted only while that generation is opening; `activity` is accepted only while it is open.
- `closed` or `failed` schedule exponential backoff.
- `tick` marks an inactive open subscription stale, times out an opening attempt, or emits a due `open` action.
- `stop` is terminal until an explicit `reset`.
- Late events carrying an old generation are ignored, preventing a replaced stream from reviving stale state.

All timestamps and durations are non-negative safe-integer milliseconds supplied by the caller. The package uses no timers, randomness, network, global state, or wall clock, which makes behavior deterministic and testable.

## Runtime and integration

Node.js 20+, ESM/CommonJS, and TypeScript declarations are included. Call `tick` from your scheduler, execute emitted actions with your MCP SDK, and feed lifecycle callbacks back with the matching generation. The shipped example is `examples/reconnect-plan.mjs`.

## Alternatives

- Use the MCP SDK lifecycle directly when it already surfaces stream closure and performs the exact retry policy you need.
- General reconnect libraries such as `reconnect-core` handle stream recreation but do not model MCP subscription freshness or generation-fence callbacks.
- `@tmcp/session-manager` manages transport sessions; this package is a small transport-agnostic subscription decision core.
- `async-iterator-watchdog` classifies iterator silence and heartbeat activity; this package instead models MCP subscription generations, invalid late callbacks, retry budgets, and explicit reopen actions.

## Limitations

This package does not implement MCP, open sockets, refresh OAuth tokens, persist state, add jitter, or prove a server catalog is current. Lack of activity is only a useful stale signal when the caller has an expected heartbeat or refresh cadence. Set `staleAfterMs` accordingly. Authentication failures should normally stop or defer retry in the host rather than repeatedly opening a browser flow.

## Troubleshooting

- Reconnects loop: increase `staleAfterMs`, feed real activity events, or stop on authentication/configuration errors.
- Events are ignored: ensure every callback carries the generation returned by its corresponding `open` action.
- Retry limit reached: inspect `state.reason`, repair the transport/authentication issue, then explicitly send `reset`.

Run `npm ci --ignore-scripts && npm run check`. The committed lockfile pins development tooling; runtime dependencies are absent. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). MIT licensed.
