/*---
description: Loop-carried multiplication preserves the alternating sign of zero.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal cannot be negative zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: multiplication by -1 changes the sign on each back edge; node retains negative zero on odd turns.
function afterTurns(turns: number): number {
  let value = 0;
  for (let i = 0; i < turns; i++) {
    value *= -1;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n % 2 === 0 ? 0 : -0);
}
