/*---
description: A mapped result contributes a fraction to the program-wide number array kind.
features: [ts-proof-element-kind, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-closures, ts-arrow-functions]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: map returns 0.25 into a new array; a separate reader retains 0.25.
function readSecond(xs: number[]): number { return xs[1]; }
function observe(n: number): number {
  const source = [1, 2, 3];
  const mapped = source.map((value, index) => {
    return index === 1 && n > 0 ? 0.25 : value;
  });
  return readSecond(mapped);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 0.25 : 2);
}
