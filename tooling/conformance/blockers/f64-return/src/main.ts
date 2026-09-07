// expect: emit-c --napi -> publishes digits
//
// FIXED. This refused until the compiler lane taught the Node-API wrapper to
// carry an array of numbers across the boundary; it is kept as a regression
// guard, because `punycode.ucs2` needs it and `ucs2` is what stood between
// this project and its first passing compiled module.
//
// The outbound direction of the same gap: allocating a JavaScript array from
// native memory rather than reading one into it. `punycode.ucs2.decode` needs
// this; node's own test never calls it, so this half is not on the critical
// path to the first green module -- but the namespace publishes whole, so
// `ucs2` needs both unless partial publication lands.
export function digits(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}
