/*---
description: A conditional wide value rounds before a difference is observed.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-expressions]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the conditional brings in 2^53; node computes (x + 1) - x as 0 on that edge.
function afterJoin(n: number): number {
  let value = 1;
  value = n > 0 ? 9007199254740992 : value;
  return (value + 1) - value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 0 : 1);
}
