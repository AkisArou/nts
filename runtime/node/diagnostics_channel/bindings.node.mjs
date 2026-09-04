// The native half of `node:diagnostics_channel`, for the node-side run only.
//
// One binding, `nts_next_tick`, and it is shared: a subscriber that throws is
// re-raised on the next tick.
import "../internal/bindings.node.mjs";
