// `structuredClone`, for the node modules that copy a caller's value with it.
//
// It is the host's global. Node's is V8's serializer, and a clone has to agree
// with it about every type it can carry -- `Map`, `Date`, `RegExp`, typed
// arrays, cycles -- so a second implementation here would be a second answer
// to a question the platform already answers.

declare global {
  function structuredClone<T>(value: T): T;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
