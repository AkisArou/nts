// The one-way warning seam between modules that can raise a process warning
// and `node:process`, which owns warning delivery.
//
// `node:process` depends on `node:events`, so `events` cannot import the
// process object merely to call `process.emitWarning()`.  A typed handler
// installed after the process object has finished construction breaks that
// cycle without a global object lookup or a dynamically shaped callback.

export type ProcessWarningHandler = (warning: Error) => void;

interface ProcessWarning extends Error {
  code?: string;
}

let processWarningHandler: ProcessWarningHandler | undefined;

/**
 * Host fallback for a program that contains a warning-producing module but
 * not the `node:process` compatibility module.
 *
 * On Node, `internal/bindings.node.mjs` forwards the exact Error object to the
 * host process. In a native program there is no process EventEmitter to
 * receive it, so the C half writes the warning to the process's diagnostic
 * stream.
 */
declare function nts_process_emit_warning_object(
  message: string,
  name: string,
  warning: Error,
): void;

/** Install the compatibility process's warning delivery path. */
export function setProcessWarningHandler(handler: ProcessWarningHandler): void {
  processWarningHandler = handler;
}

/** Deliver the exact warning object, preserving module-specific fields. */
export function emitProcessWarning(warning: Error): void {
  const handler = processWarningHandler;
  if (handler === undefined) {
    nts_process_emit_warning_object(warning.message, warning.name, warning);
    return;
  }
  handler(warning);
}

/**
 * Raise the common string/type/code form of `process.emitWarning` without
 * making every caller depend on the process object or on a second native
 * warning ABI.
 */
export function emitWarning(message: string, name: string, code: string): void {
  const warning: ProcessWarning = new Error(message);
  warning.name = name;
  if (code !== "") warning.code = code;
  emitProcessWarning(warning);
}
