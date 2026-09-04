import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// The native half of `node:util`, for the node-side run only.
//
// The process-level ones are shared; what is left is the errno table, which
// `util.getSystemErrorName` and the error messages are built from.
import "../internal/bindings.node.mjs";

globalThis.nts_uv_error_codes = () => [...require("node:util").getSystemErrorMap().keys()];
globalThis.nts_uv_error_names = () =>
  [...require("node:util").getSystemErrorMap().values()].map((v) => v[0]);
