/*---
description: A positive-zero early return does not erase the surviving negative-zero path.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the +0 path exits early; node preserves -0 on the surviving return.
function afterJoin(n: number): number {
  let value = 0;
  if (n <= 0) return value;
  value = -0;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? -0 : 0);
}
