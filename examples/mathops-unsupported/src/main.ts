// `Math` members the compiler does not implement. Each must be refused rather
// than guessed at from its spelling: emitting a call to a C function that
// happens to share a name would be assuming libm agrees about the semantics,
// and for `round` and `min` it demonstrably does not.
//
// When one of these lands, move it to examples/mathops rather than deleting it.
//
// **Rewritten on 2026-09-17, because every arm it held had landed.** `sinh` and
// `sqrt` are implemented and were still sitting here; the only thing still
// refusing was a three-argument `Math.max`, which is an *arity* and not a
// member. So the test above it -- named for a member being refused -- had been
// passing on a different fact than its name for as long as that took, and
// `Math.max(a, b, c)` landing is what made it say so.
//
// These four are refused by the intrinsic table's `_ => return None`, which is
// the mechanism the test is about.

export function leadingZeros(x: number): number {
  return Math.clz32(x);
}

export function areaSinh(x: number): number {
  return Math.asinh(x);
}

export function areaCosh(x: number): number {
  return Math.acosh(x);
}

export function areaTanh(x: number): number {
  return Math.atanh(x);
}
