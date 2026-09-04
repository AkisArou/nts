// What counts as a stream, from node v24.20.0 `lib/internal/streams/utils.js`.
//
// Structural, not nominal: several widely used packages implement the stream
// contracts without extending Node's classes. The checks narrow each property
// before reading it, so no open-object assertion or prototype lookup is
// needed.

export function isReadableStream(value: unknown): boolean {
  if (!isRecord(value) || isNodeStream(value)) return false;
  return "pipeThrough" in value && isFunction(value.pipeThrough) &&
    "getReader" in value && isFunction(value.getReader) &&
    "cancel" in value && isFunction(value.cancel);
}

export function isWritableStream(value: unknown): boolean {
  if (!isRecord(value) || isNodeStream(value)) return false;
  return "getWriter" in value && isFunction(value.getWriter) &&
    "abort" in value && isFunction(value.abort);
}

/**
 * A node stream: one that carries the internal state, or -- for the many
 * third-party implementations that do not -- one that reads or writes and
 * emits events.
 */
export function isNodeStream(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Boolean(
    ("_readableState" in value && value._readableState) ||
    ("_writableState" in value && value._writableState) ||
    ("pipe" in value && isFunction(value.pipe) &&
      "on" in value && isFunction(value.on)) ||
    ("write" in value && isFunction(value.write) &&
      "on" in value && isFunction(value.on)),
  );
}

function isRecord(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function isFunction(value: unknown): boolean {
  return typeof value === "function";
}
