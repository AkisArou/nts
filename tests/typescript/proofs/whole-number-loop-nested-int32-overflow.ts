/*---
description: An inner loop carries a wider integer to the next outer iteration.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal fits int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: two inner updates cross int32; node does not wrap on either loop edge.
function afterNested(turns: number): number {
  let value = 2147483646;
  for (let outer = 0; outer < turns; outer++) {
    for (let inner = 0; inner < 2; inner++) value++;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterNested(n), 2147483646 + 2 * n);
}
