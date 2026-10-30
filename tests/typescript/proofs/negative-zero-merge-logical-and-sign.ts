/*---
description: The taken right operand of && can change the zero sign at the join.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-expressions]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the short-circuit edge joins with a -0 assignment; node preserves the assigned sign.
function afterJoin(n: number): number {
  let value = 0;
  n > 0 && (value = -0);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? -0 : 0);
}
