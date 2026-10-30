/*---
description: A fractional branch is added before a joined sum is truncated.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: both initial addends are int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the fractional edge gives 0.75 twice; node truncates their sum to 1.
function truncatedAtJoin(n: number): number {
  let a = 1;
  let b = 1;
  if (n > 0) {
    a = 0.75;
    b = 0.75;
  }
  return (a + b) | 0;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(truncatedAtJoin(n), n > 0 ? 1 : 2);
}
