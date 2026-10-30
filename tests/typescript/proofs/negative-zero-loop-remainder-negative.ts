/*---
description: A later negative dividend gives a negative-zero remainder.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal cannot be negative zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a later iteration supplies -6; node preserves -0 from its exact remainder.
function afterTurns(turns: number): number {
  let value = 6;
  for (let i = 0; i < turns; i++) {
    if (i === 1) value = -6;
    value %= 3;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n === 0 ? 6 : n === 1 ? 0 : -0);
}
