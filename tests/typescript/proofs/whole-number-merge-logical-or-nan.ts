/*---
description: The fallback operand of || carries NaN to the join.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-expressions]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the fallback remainder joins a whole path; node retains NaN.
function afterJoin(n: number): number {
  let value = 7;
  n > 0 || (value %= 0);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 7 : NaN);
}
