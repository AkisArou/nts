/*---
description: Quarter-step loop updates do not retain an integer-only representation.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal is a whole int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: each back edge carries a fraction; three updates give 0.75 in node.
function afterTurns(turns: number): number {
  let value = 0;
  for (let i = 0; i < turns; i++) {
    value += 0.25;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n / 4);
}
