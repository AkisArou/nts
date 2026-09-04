// `Math` members the compiler does not implement. Each must be refused rather
// than guessed at from its spelling: emitting a call to a C function that
// happens to share a name would be assuming libm agrees about the semantics,
// and for `round` and `min` it demonstrably does not.
//
// When one of these lands, move it to examples/mathops rather than deleting it.
export function hyperbolic(x: number): number {
  return Math.sinh(x);
}

export function root(x: number): number {
  return Math.sqrt(x);
}

export function widest(a: number, b: number, c: number): number {
  return Math.max(a, b, c);
}
