/*---
description: A forEach callback can invalidate a captured whole-number fact.
features: [ts-proof-whole-number, ts-route-callback, ts-functions, ts-iteration, ts-numbers, ts-closures, ts-arrow-functions, ts-arrays]
---*/
// Fact: the captured binding begins with whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the matching callback writes 0.25; node retains the fraction after iteration.
function afterForEach(n: number): number {
  let value = 1;
  [0, 1, 2].forEach((step) => {
    if (step === n) value = 0.25;
  });
  return value;
}

for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterForEach(n), n >= 0 && n < 3 ? 0.25 : 1);
}
