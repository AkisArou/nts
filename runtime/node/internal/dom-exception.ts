// The `DOMException`s node's own modules throw: node's `lazyDOMException`.
//
// The class is the host's global rather than an import. A `DOMException` is
// recognised by identity -- `err instanceof DOMException`, `err.name` -- and
// the one a caller can name is the global one, so constructing any other would
// produce an error nothing matches.
//
// One declaration of the global for the whole profile: two modules each
// declaring `var DOMException` with their own interface is a conflict the
// aggregate `tsconfig.json` reports, whether or not the two ever meet.

interface NodeDOMExceptionConstructor {
  new (message?: string, name?: string): Error;
  new (message: string, options: { name: string; cause: unknown }): Error;
}

declare global {
  var DOMException: NodeDOMExceptionConstructor;
}

export function domException(message: string, name: string): Error {
  return new globalThis.DOMException(message, name);
}

/** The same, carrying the error that caused it -- `new DOMException(message, { name, cause })`. */
export function domExceptionWithCause(message: string, name: string, cause: unknown): Error {
  return new globalThis.DOMException(message, { name, cause });
}
