/*---
description: A find predicate stores NaN before a separate array reader runs.
features: [ts-proof-element-kind, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-closures, ts-arrow-functions]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a find callback writes NaN; the separate reader observes NaN.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1, 2];
  [0, 1].find(() => {
    if (n > 0) xs[0] = NaN;
    return true;
  });
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? NaN : 1);
}
