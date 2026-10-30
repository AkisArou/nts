/*---
description: A later division can introduce negative zero into a numeric loop value.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal cannot be negative zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the second iteration divides positive seven by -Infinity; node retains -0 afterwards.
function afterTurns(turns: number): number {
  let value = 7;
  for (let i = 0; i < turns; i++) {
    if (i === 1) value /= -Infinity;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 7 : -0);
}
