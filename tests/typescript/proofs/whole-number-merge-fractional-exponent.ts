/*---
description: A squared branch result keeps its fractional value after the join.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-exponent]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the fractional edge supplies 0.5; node squares it to exactly 0.25.
function afterJoin(n: number): number {
  let value = 2;
  if (n > 0) value = 0.5;
  return value ** 2;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 0.25 : 4);
}
