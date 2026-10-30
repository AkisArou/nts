/*---
description: An inner loop carries a changed zero sign into the outer observation.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the entry value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: three inner negations flip the sign per outer turn; node preserves the final sign.
function afterNested(turns: number): number {
  let value = 0;
  let observed = 0;
  for (let outer = 0; outer < turns; outer++) {
    for (let inner = 0; inner < 3; inner++) value = -value;
    observed = value;
  }
  return observed;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterNested(n), n % 2 === 0 ? 0 : -0);
}
