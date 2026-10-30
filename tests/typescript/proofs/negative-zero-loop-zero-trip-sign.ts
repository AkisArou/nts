/*---
description: The zero-trip edge preserves positive zero while a body visit introduces negative zero.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal cannot be negative zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the loop body writes -0 while zero trips leave +0; node distinguishes the two exit paths.
function afterTurns(turns: number): number {
  let value = 0;
  for (let i = 0; i < turns; i++) {
    value = -0;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n === 0 ? 0 : -0);
}
