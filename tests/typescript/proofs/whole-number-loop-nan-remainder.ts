/*---
description: A zero divisor on a later iteration invalidates the no-NaN fact.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal is whole and not NaN (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the second remainder divides by zero; node retains NaN afterwards.
function afterTurns(turns: number): number {
  let value = 7;
  for (let i = 0; i < turns; i++) {
    value %= i === 1 ? 0 : 2;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n === 0 ? 7 : n === 1 ? 1 : NaN);
}
