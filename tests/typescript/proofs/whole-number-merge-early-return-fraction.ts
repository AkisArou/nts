/*---
description: A fractional surviving path is not narrowed by the integer early return.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the integer path returns early; node retains 0.25 on the surviving return.
function afterJoin(n: number): number {
  let value = 1;
  if (n <= 0) return value;
  value = 1 / 4;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 0.25 : 1);
}
