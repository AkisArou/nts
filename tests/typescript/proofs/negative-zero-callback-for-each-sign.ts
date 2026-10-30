/*---
description: A forEach callback can invalidate a captured positive-zero fact.
features: [ts-proof-negative-zero, ts-route-callback, ts-functions, ts-iteration, ts-numbers, ts-arrays, ts-closures, ts-arrow-functions]
---*/
// Fact: the captured binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a matching callback writes -0; node retains its sign after iteration.
function afterForEach(n: number): number {
  let value = 0;
  [0, 1, 2].forEach((step) => {
    if (step === n) value = -0;
  });
  return value;
}

for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterForEach(n), n >= 0 && n < 3 ? -0 : 0);
}
