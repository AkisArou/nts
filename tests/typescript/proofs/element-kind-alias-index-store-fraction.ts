/*---
description: An aliased index writer contributes a fraction to the original array kind.
features: [ts-proof-element-kind, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a second name stores 0.25; a separate reader of the original keeps it.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1, 2];
  const alias = xs;
  if (n > 0) alias[0] = 0.25;
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 0.25 : 1);
}
