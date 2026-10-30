/*---
description: A late wide addend rounds before a sum is truncated to int32.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial addend is int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the back edge supplies 2^53; node rounds its +1 before truncating, giving 0.
function truncatedAfterWide(turns: number): number {
  let value = 1;
  let result = 0;
  for (let i = 0; i < turns; i++) {
    result = (value + 1) | 0;
    value = 9007199254740992;
  }
  return result;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(truncatedAfterWide(n), n === 1 ? 2 : 0);
}
