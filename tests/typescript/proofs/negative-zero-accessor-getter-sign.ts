/*---
description: Reading a getter can invalidate a captured positive-zero fact.
features: [ts-proof-negative-zero, ts-route-accessor, ts-functions, ts-iteration, ts-numbers, ts-accessors, ts-objects, ts-closures]
---*/
// Fact: the captured binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the getter writes -0 during the property read; node retains the written sign.
function afterGetter(n: number): number {
  let value = 0;
  const object = {
    get touch(): number {
      if (n > 0) value = -0;
      return 0;
    }
  };
  object.touch;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterGetter(n), n > 0 ? -0 : 0);
}
