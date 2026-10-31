// The native half of `node:querystring`, for the node-side run only.
//
// Nothing of its own: what it needs is the shared process-level bindings that
// the code under `internal/` declares.
import "../internal/bindings.node.mjs";
// The typed dependency closure initializes Buffer's allocation pool.
import "../buffer/bindings.node.mjs";
