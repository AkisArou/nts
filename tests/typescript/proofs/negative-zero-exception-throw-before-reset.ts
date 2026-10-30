/*---
description: A caught throw can leave negative zero when it skips a positive-zero reset.
features: [ts-proof-negative-zero, ts-route-exception, ts-functions, ts-iteration, ts-numbers, ts-errors]
---*/
// Fact: the binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a throw skips restoration after writing -0; node retains the negative sign.
function afterInterruptedUpdate(n: number): number {
  let value = 0;
  try {
    value = -0;
    if (n > 0) throw new Error("keep the update");
    value = 0;
  } catch {}
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterInterruptedUpdate(n), n > 0 ? -0 : 0);
}
