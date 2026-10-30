/*---
description: A later zero times Infinity invalidates a whole loop value.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial zero is whole and not NaN (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the second iteration multiplies by Infinity; node gives NaN.
function afterTurns(turns: number): number {
  let value = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 1) value *= Infinity;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 0 : NaN);
}
