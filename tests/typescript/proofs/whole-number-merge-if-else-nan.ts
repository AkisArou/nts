/*---
description: A branch join retains NaN from one incoming edge.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the zero-divisor arm joins a whole arm; node preserves NaN.
function afterJoin(n: number): number {
  let value = 1;
  if (n > 0) value = 0 / 0;
  else value = 7;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? NaN : 7);
}
