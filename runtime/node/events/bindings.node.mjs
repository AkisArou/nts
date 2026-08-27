// The native half of `node:events`, for the node-side run only.
//
// One binding: a warning has to reach somewhere, and where that is belongs to
// the process rather than to `events`. Node calls `process.emitWarning`; the
// compiled form will call whatever the runtime's warning sink turns out to be.
import process from "node:process";

globalThis.nts_process_emit_warning = (name, message, detail) => {
  // Node's tests read `emitter`, `type` and `count` off the warning they catch,
  // so the object the implementation built is the one that must be emitted.
  const warning = detail instanceof Error ? detail : new Error(message);
  warning.name = name;
  process.emitWarning(warning);
};
