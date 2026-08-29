// The native half of `node:async_hooks`, for the node-side run only.
//
// Nothing of its own. The four primitives this module needs -- the context
// carrier, the promise hooks, collection notices and a raw microtask -- are
// defined in `internal/` instead, because `internal/tick.ts` and `node:timers`
// report themselves to the hooks: a program that never mentions this module
// still needs them, so they cannot live here.
//
// The file exists because the harness installs a module's bindings by looking
// for it, and without it this module would load with none.
import "../internal/bindings.node.mjs";
