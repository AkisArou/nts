// `join` with an absent separator joins with a comma: `[1, 2].join(undefined)`
// and a `join(sep?: string)` called without one are both "1,2". The lowering
// handed the absent separator to the runtime as a null string, which C, LLVM
// and RC dereferenced (SIGSEGV) -- found by the Wasm lane naming its refusal
// of the same shape. `null` would join as "null", so the runtime cannot tell
// the two apart; the type can, and `separator?: string` admits only undefined.
export function joinUndefined(n: number): string {
  return [n, n + 1].join(undefined);
}
function joinWith(xs: number[], sep?: string): string {
  return xs.join(sep);
}
export function joinOmitted(n: number): string {
  return joinWith([n, n * 2]);
}
export function joinStrings(n: number): string {
  return ["a" + n, "b"].join(undefined);
}
// The controls: a separator that is given, directly and through the optional.
export function joinDash(n: number): string {
  return [n, n + 1].join("-");
}
export function joinGiven(n: number): string {
  return joinWith([n, n * 2], "-");
}
