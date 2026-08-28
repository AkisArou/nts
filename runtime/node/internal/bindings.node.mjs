// The native half of everything under `runtime/node/internal/`, for the
// node-side run only.
//
// These stand for what the process itself provides -- its streams, its
// environment, its clock, its tick queue -- and every module needs some of
// them because the shared code under `internal/` does. One file rather than a
// copy per module: a binding defined twice with two slightly different bodies
// is a bug that only shows up in whichever module is tested second.
//
// Each module's own `bindings.node.mjs` imports this and adds what is its own.
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Read at call time, not captured: node's tests replace `process.stdout.write`
// to see what was printed, and a captured reference would miss the
// replacement.
globalThis.nts_write_stdout = (text) => { process.stdout.write(text); };
globalThis.nts_write_stderr = (text) => { process.stderr.write(text); };
globalThis.nts_stdout_is_tty = () => Boolean(process.stdout.isTTY);
globalThis.nts_stderr_is_tty = () => Boolean(process.stderr.isTTY);
globalThis.nts_stdio_color_depth = () =>
  (typeof process.stdout.getColorDepth === "function" ? process.stdout.getColorDepth() : 1);

globalThis.nts_process_env = (name) => process.env[name] ?? "";
globalThis.nts_process_env_has = (name) => process.env[name] !== undefined;
globalThis.nts_process_pid = () => process.pid;
globalThis.nts_process_emit_warning = (message, name, code) => {
  process.emitWarning(message, name, code || undefined);
};

globalThis.nts_hrtime_ns = () => process.hrtime.bigint();
globalThis.nts_process_is_exiting = () => Boolean(process._exiting);
globalThis.nts_next_tick = (callback, args) => { process.nextTick(callback, ...(args ?? [])); };

globalThis.nts_debug_write = (text) => { process.stderr.write(text); };
globalThis.nts_platform = () => process.platform;
globalThis.nts_process_cwd = () => process.cwd();

// Node suppresses a deprecation warning raised from inside a dependency, on
// the grounds that the application cannot act on it. A compiled program has no
// `node_modules` to be inside, so the compiled answer is always false; on node
// the stack is what says.
globalThis.nts_is_inside_node_modules = () => false;

// libuv's error table, for `internal/uv.ts`.
//
// Here rather than in `fs` and `util`, which each had their own copy. The two
// had already drifted: one asked `getSystemErrorMessage` and fell back to a
// hand-written table, the other read `getSystemErrorMap` and answered "unknown
// error". A rule with two implementations has two behaviours, and which one a
// module got depended on which bindings file it happened to load.
globalThis.nts_uv_err_name = (code) => {
  try {
    return require("node:util").getSystemErrorName(code);
  } catch {
    return "UNKNOWN";
  }
};

globalThis.nts_uv_err_message = (code) => {
  const util = require("node:util");
  if (typeof util.getSystemErrorMessage === "function") {
    try {
      return util.getSystemErrorMessage(code);
    } catch {
      // Fall through to the map.
    }
  }
  const entry = util.getSystemErrorMap().get(code);
  return entry ? entry[1] : "unknown error";
};
