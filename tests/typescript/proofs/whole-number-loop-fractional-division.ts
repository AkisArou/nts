/*---
description: A later division of an initially whole loop value retains its fraction.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal is a whole int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the second iteration divides by 2; node keeps 3.5 on later edges.
function afterTurns(turns: number): number {
  let value = 7;
  for (let i = 0; i < turns; i++) {
    if (i === 1) value /= 2;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 7 : 3.5);
}
