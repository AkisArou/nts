/*---
description: A branch join retains a fraction from one incoming edge.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the division arm joins an integer arm; node preserves 3.5.
function afterJoin(n: number): number {
  let value = 7;
  if (n > 0) value /= 2;
  else value += 1;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 3.5 : 8);
}
