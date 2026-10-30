/*---
description: A loop-carried fractional addend is added before bitwise truncation.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: both initial addends are int32, licensing a wrapping integer sum (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the back edge replaces both by 0.75; node truncates their sum to 1, not each addend.
function truncatedAfterTurns(turns: number): number {
  let a = 1;
  let b = 1;
  let result = 0;
  for (let i = 0; i < turns; i++) {
    result = (a + b) | 0;
    a = 0.75;
    b = 0.75;
  }
  return result;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(truncatedAfterTurns(n), n === 0 ? 0 : n === 1 ? 2 : 1);
}
