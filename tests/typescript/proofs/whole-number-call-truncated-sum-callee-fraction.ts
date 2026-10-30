/*---
description: Fractional callee results are added before bitwise truncation.
features: [ts-proof-whole-number, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the callee starts with an int32 result (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a call returns 0.75 to both addends; node truncates their sum to 1.
function supply(n: number): number {
  let value = 1;
  if (n > 0) value = 0.75;
  return value;
}

function truncatedCalls(n: number): number {
  const a = supply(n);
  const b = supply(n);
  return (a + b) | 0;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(truncatedCalls(n), n > 0 ? 1 : 2);
}
