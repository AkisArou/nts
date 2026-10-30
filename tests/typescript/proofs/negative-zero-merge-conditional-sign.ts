/*---
description: A conditional expression preserves distinct signs of zero at its join.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-expressions]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the conditional chooses +0 or -0; node retains the chosen sign.
function afterJoin(n: number): number {
  let value = 0;
  value = n > 0 ? -0 : value;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? -0 : 0);
}
