/*---
description: A converted infinite divisor introduces negative zero through a compound store.
features: [ts-proof-element-kind, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-conversions, ts-to-primitive, ts-objects]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: valueOf returns -Infinity; storing 1 / -Infinity must keep -0.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1, 2];
  const divisor = {
    valueOf(): number { return n > 0 ? -Infinity : 1; }
  };
  xs[0] /= Number(divisor);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? -0 : 1);
}
