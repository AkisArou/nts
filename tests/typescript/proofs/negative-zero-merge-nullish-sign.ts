/*---
description: A non-nullish negative zero survives the nullish-coalescing join.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-expressions, ts-unions, ts-null-undefined]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the candidate is -0 or missing; node keeps non-nullish -0 and uses +0 only for missing.
function afterJoin(n: number): number {
  let value = 0;
  const candidate: number | undefined = n > 0 ? -0 : undefined;
  value = candidate ?? 0;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? -0 : 0);
}
