// The native half of `node:stream`, for the node-side run only.
//
// There is none of its own: a stream is state and callbacks, and everything
// underneath it -- the tick queue, the clock, the streams `internal/` uses --
// belongs to the shared process bindings. The siblings whose implementations
// this module calls into need their native halves present, though.
import "../internal/bindings.node.mjs";
import "../buffer/bindings.node.mjs";
import "../events/bindings.node.mjs";
