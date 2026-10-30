/*---
description: A nonnegative branch range does not survive a join with a negative value.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the guarded nonnegative arm joins -1; node keeps its negative remainder.
function afterJoin(n: number): number {
  let value = 0;
  if (n >= 0 && n < 4) value = n;
  else value = -1;
  return value % 3;
}

for (const n of [0, 1, 3, 4, 7, -1]) {
  assert.sameValue(afterJoin(n), n >= 0 && n < 4 ? n % 3 : -1);
}
