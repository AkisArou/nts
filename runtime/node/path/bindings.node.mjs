// The native half of `node:path`, for the node-side run only.
//
// Each `declare function` in the TypeScript erases to nothing when node strips
// types, so its call site becomes an ordinary global lookup. Defining the
// global here is what makes one source runnable both ways: compiled, the call
// is an extern satisfied by this module’s own C; on node, it is this.
//
// These stand-ins are only as good as their agreement with the C, and nothing
// but `nts check` compares them. Keep them trivial for that reason: anything
// with judgement in it belongs in the TypeScript, where there is one copy.
import "../internal/bindings.node.mjs";
import process from "node:process";

globalThis.nts_process_cwd = () => process.cwd();
globalThis.nts_process_env = (name) => process.env[name] ?? "";
