// The native half of `node:readline`, for the node-side run only.
//
// Nothing of its own: a line editor is escape sequences written to a stream
// and characters read from one, and both of those belong to whatever stream it
// was handed. What it does need is the shared `internal/` bindings, because
// the modules underneath it -- `string_decoder`, `timers`, `events` -- have
// native halves of their own.
import "../internal/bindings.node.mjs";
// The typed dependency closure initializes Buffer's allocation pool.
import "../buffer/bindings.node.mjs";
import "../timers/bindings.node.mjs";
