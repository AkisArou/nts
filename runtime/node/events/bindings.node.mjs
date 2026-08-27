// The native half of `node:events`, for the node-side run only.
//
// One binding: a warning has to reach somewhere, and where that is belongs to
// the process rather than to `events`. Node calls `process.emitWarning`; the
// compiled form will call whatever the runtime's warning sink turns out to be.
import process from "node:process";

globalThis.nts_events_emit_max_listeners_warning = (message, warning) => {
  // The object the implementation built, not a fresh one: node's tests read
  // `emitter`, `type` and `count` off the warning they catch.
  process.emitWarning(warning instanceof Error ? warning : new Error(message));
};
