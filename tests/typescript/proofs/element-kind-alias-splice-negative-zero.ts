/*---
description: A splice through an alias preserves the negative sign of stored zero.
features: [ts-proof-element-kind, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a second name splices in -0; a separate reader distinguishes it from 0.
function readSecond(xs: number[]): number { return xs[1]; }
function observe(n: number): number {
  const xs = [1, 2];
  const alias = xs;
  alias.splice(1, 1, n > 0 ? -0 : 0);
  return readSecond(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? -0 : 0);
}
