import { debugSectionEnabled } from "../../internal/debug-env.ts";
import { emitWarning } from "../../internal/process-warning.ts";

const HTTP_DEBUG_WARNING =
  "Setting the NODE_DEBUG environment variable to 'http' can expose sensitive data " +
  "(such as passwords, tokens and authentication headers) in the resulting log.";
const httpDebugEnabled = debugSectionEnabled("HTTP");
let warningEmitted = false;

/** Emit Node's security warning at the first operation in an enabled process. */
export function emitHttpDebugWarning(): void {
  if (!httpDebugEnabled || warningEmitted) return;
  warningEmitted = true;
  emitWarning(HTTP_DEBUG_WARNING, "Warning", "");
}
