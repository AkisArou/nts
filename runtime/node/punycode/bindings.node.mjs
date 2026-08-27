// The native half of `node:punycode`, for the node-side run only.
//
// Two bindings, and both are really about the *process* rather than about
// punycode: where a warning goes, and whether the caller is a dependency.
import process from "node:process";

globalThis.nts_process_emit_warning = (message, name, code) => {
  process.emitWarning(message, name, code);
};

// Node walks the stack looking for a `node_modules` frame. Ours is always the
// application, because a compiled program has no `node_modules` to be inside.
globalThis.nts_is_inside_node_modules = () => false;
