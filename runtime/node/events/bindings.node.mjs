// The native half of `node:events`, for the node-side run only. The shared
// bindings provide both process-warning delivery and the raw microtask queue
// used by `addAbortListener` for an already-aborted signal.
import "../internal/bindings.node.mjs";
