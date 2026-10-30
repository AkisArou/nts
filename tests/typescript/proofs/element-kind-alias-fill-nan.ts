/*---
description: A fill through an alias contributes NaN to the original array kind.
features: [ts-proof-element-kind, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a second name fills with NaN; a separate reader observes NaN.
function readSecond(xs: number[]): number { return xs[1]; }
function observe(n: number): number {
  const xs = [1, 2, 3];
  const alias = xs;
  if (n > 0) alias.fill(NaN);
  return readSecond(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? NaN : 2);
}
