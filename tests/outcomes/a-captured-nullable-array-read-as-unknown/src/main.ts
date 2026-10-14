// A closure reading a captured `(string | null)[]` element as `unknown`.
//
// The stored `null` comes back tagged as a string -- the null pointer erased
// with the element's tag -- where node answers `null`; the example that found
// it went on to read `.length` of that "string" and was killed by signal 11.
// The control is the same read in an ordinary function taking the array, which
// agrees, so the difference is the capture.
//
// Found by an example that came with erased storage for nullable reference
// arrays (86528f0c4, ported from the Codex branch), which was taken out of the
// landing it rode in: the erased-element array has a helper for `push` only, so
// `fill`, `slice`, `pop`, `indexOf`, `map` and twelve other methods refused on
// any `(T | null)[]` main compiles. That storage also answers a question this
// read cannot -- a stored `null` and a hole are both the null pointer in a
// reference array -- and waits for the erased-element method family.
function describe(value: unknown): string {
  return value === null ? "null" : value === undefined ? "undefined" : typeof value;
}
function reader(values: (string | null)[], index: number): () => unknown {
  return () => values[index];
}
function at(values: (string | null)[], index: number): unknown {
  return values[index];
}
observe("captured", describe(reader([null, "abc"], 0)()));
observe("passed control", describe(at([null, "abc"], 0)));
done();
