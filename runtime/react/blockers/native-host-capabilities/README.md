# Native scheduler and host capabilities

The full runtime probe finds browser/Node capability lookups for `performance`,
`MessageChannel`, `console`, `window.dispatchEvent`, and abort controllers.
These are native host interfaces rather than reasons to weaken React's types.

The native profile should select an adaptation of upstream
`SchedulerNative.js` and expose typed bindings for:

- a monotonic clock;
- posting and canceling work;
- current priority and yield decisions;
- error reporting; and
- abort controller/signal behavior where reachable React features require it.

Each platform adapter can implement those bindings using its real event loop.
The recording host supplies deterministic versions for conformance. Dynamic
probing of browser globals should disappear only after profile selection proves
the native binding, while JSON, AggregateError, Symbol and collection refusals
remain separate standard-library/compiler items.
