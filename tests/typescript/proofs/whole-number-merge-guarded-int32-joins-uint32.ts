/*---
description: An int32 guard on one branch cannot narrow a uint32 value at the join.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the other arm supplies UINT32_MAX; node preserves 4294967295.
function afterJoin(n: number): number {
  let value = 0;
  if (n >= -2147483648 && n <= 2147483647) value = n | 0;
  else value = 4294967295;
  return value;
}

for (const n of [-1, 0, 1, 2147483647, 2147483648, 4294967296]) {
  assert.sameValue(afterJoin(n), n <= 2147483647 ? n : 4294967295);
}
