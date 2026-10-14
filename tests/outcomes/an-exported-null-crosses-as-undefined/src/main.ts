// run: check
//
// An exported function's `null` reaches a host caller as `undefined`.
//
// `string | null` and `string | undefined` lower to one type, a managed
// reference whose null pointer is the absent value, and lowering knows which
// absent value each one means: inside the program `orNull(false) === null`,
// `typeof` and `String()` all agree with node. The publication boundary does
// not: nothing on the exported function says which of the two its null
// pointer stands for, so the N-API glue answers `undefined` for both, and
// node's `null` is lost.
//
// Wasm refuses both shapes by name at the same boundary ("result is outside
// primitive-string boundary"), for the same missing fact.
//
// The control differs in one thing, `undefined` for `null`, and agrees.
export function stringOrNull(present: boolean): string | null {
  return present ? "text" : null;
}
export function stringOrUndefined(present: boolean): string | undefined {
  return present ? "text" : undefined;
}
