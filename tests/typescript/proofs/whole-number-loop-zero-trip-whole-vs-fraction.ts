/*---
description: The zero-trip edge and fractional loop body share a representation safely.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the entry value is a whole int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: zero trips preserve 7 while a body visit gives node exactly 3.5.
function afterTurns(turns: number): number {
  let value = 7;
  for (let i = 0; i < turns; i++) {
    value = 7 / 2;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n === 0 ? 7 : 3.5);
}
