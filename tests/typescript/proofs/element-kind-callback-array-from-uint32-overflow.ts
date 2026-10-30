/*---
description: Array.from's mapper introduces a value beyond uint32 into the program-wide array element kind.
features: [ts-proof-element-kind, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-closures, ts-arrow-functions]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: Array.from returns 4294967296 at index 1; a separate reader must retain it.
function readSecond(xs: number[]): number { return xs[1]; }
function observe(n: number): number {
  const source = [1, 2, 3];
  const made = Array.from(source, (value, index) => {
    return index === 1 && n > 0 ? 4294967296 : value;
  });
  return readSecond(made);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 4294967296 : 2);
}
