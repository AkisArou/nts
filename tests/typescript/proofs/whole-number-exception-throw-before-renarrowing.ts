/*---
description: A throw can leave an updated numeric binding outside its original int32 range.
features: [ts-proof-whole-number, ts-route-exception, ts-functions, ts-iteration, ts-numbers, ts-errors]
---*/
// Fact: the binding begins at INT32_MAX (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a caught throw skips restoration after increment; node retains 2147483648.
function afterInterruptedUpdate(n: number): number {
  let value = 2147483647;
  try {
    value++;
    if (n > 0) throw new Error("keep the update");
    value = 0;
  } catch {}
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterInterruptedUpdate(n), n > 0 ? 2147483648 : 0);
}
