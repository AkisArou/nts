// What counts as a stream, from node v24.20.0 `lib/internal/streams/utils.js`.
//
// Duck-typing, not `instanceof`: a stream may come from a different realm, and
// several widely used packages implement the interface without extending
// node's classes. Node accepts those, so these predicates ask what an object
// can do rather than what it descends from.

/** The web streams, which are globals rather than a module. */
interface WebStreamGlobals {
  ReadableStream?: new () => unknown;
  WritableStream?: new () => unknown;
}

export function isReadableStream(value: unknown): boolean {
  const ctor = (globalThis as WebStreamGlobals).ReadableStream;
  return ctor !== undefined && value instanceof ctor;
}

export function isWritableStream(value: unknown): boolean {
  const ctor = (globalThis as WebStreamGlobals).WritableStream;
  return ctor !== undefined && value instanceof ctor;
}

interface MaybeNodeStream {
  _readableState?: unknown;
  _writableState?: unknown;
  pipe?: unknown;
  on?: unknown;
  write?: unknown;
}

/**
 * A node stream: one that carries the internal state, or -- for the many
 * third-party implementations that do not -- one that reads or writes and
 * emits events.
 */
export function isNodeStream(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as MaybeNodeStream;
  return Boolean(
    candidate._readableState ||
    candidate._writableState ||
    (typeof candidate.pipe === "function" && typeof candidate.on === "function") ||
    (typeof candidate.write === "function" && typeof candidate.on === "function"),
  );
}
