// The native half of `node:console`, for the node-side run only.
//
// Each of these is one `declare function` in the TypeScript. They read
// `process.stdout` at call time rather than capturing it, because node's tests
// replace `process.stdout.write` to see what was printed and a captured
// reference would miss the replacement.
import process from "node:process";

globalThis.nts_write_stdout = (text) => { process.stdout.write(text); };
globalThis.nts_write_stderr = (text) => { process.stderr.write(text); };
globalThis.nts_stdout_is_tty = () => Boolean(process.stdout.isTTY);
globalThis.nts_stderr_is_tty = () => Boolean(process.stderr.isTTY);
globalThis.nts_stdio_color_depth = () =>
  (typeof process.stdout.getColorDepth === "function" ? process.stdout.getColorDepth() : 1);
globalThis.nts_hrtime_ns = () => process.hrtime.bigint();
globalThis.nts_process_env = (name) => process.env[name] ?? "";
globalThis.nts_process_env_has = (name) => process.env[name] !== undefined;
globalThis.nts_process_emit_warning = (message, name, code) => {
  process.emitWarning(message, name, code || undefined);
};
