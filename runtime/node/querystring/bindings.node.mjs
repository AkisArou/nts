// The native half of `node:querystring`, for the node-side run only.
//
// Nothing of its own: what it needs is the shared process-level bindings that
// the code under `internal/` declares.
import "../internal/bindings.node.mjs";
