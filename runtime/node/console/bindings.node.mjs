// The native half of `node:console`, for the node-side run only.
//
// Everything console needs -- the two streams, the clock, the warning sink --
// is shared with the rest of the profile and lives in `internal`.
import "../internal/bindings.node.mjs";
