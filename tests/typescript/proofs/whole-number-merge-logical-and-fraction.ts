/*---
description: The taken right operand of && carries a fraction to the join.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-expressions]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the short-circuit edges join 1 and 0.5; node keeps the fraction.
function afterJoin(n: number): number {
  let value = 1;
  n > 0 && (value = 0.5);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 0.5 : 1);
}
