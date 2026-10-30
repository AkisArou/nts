/*---
description: A rounded whole loop result can still be negative zero.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal cannot be negative zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the second iteration rounds a negative fraction upward; node preserves the resulting -0.
function afterTurns(turns: number): number {
  let value = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 1) value = Math.ceil(-0.25);
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 0 : -0);
}
