import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// The native half of `node:util`, for the node-side run only.
import process from "node:process";

globalThis.nts_process_emit_warning = (message, name, code) => {
  process.emitWarning(message, name, code || undefined);
};
globalThis.nts_process_env = (name) => process.env[name] ?? "";
globalThis.nts_process_pid = () => process.pid;
globalThis.nts_debug_write = (text) => process.stderr.write(text);

globalThis.nts_uv_err_name = (code) => {
  try { return require("node:util").getSystemErrorName(code); } catch { return "UNKNOWN"; }
};

globalThis.nts_uv_err_message = (code) => {
  const entry = require("node:util").getSystemErrorMap().get(code);
  return entry ? entry[1] : "unknown error";
};
globalThis.nts_uv_error_codes = () => [...require("node:util").getSystemErrorMap().keys()];
globalThis.nts_uv_error_names = () =>
  [...require("node:util").getSystemErrorMap().values()].map((v) => v[0]);
