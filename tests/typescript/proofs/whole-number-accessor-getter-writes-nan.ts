/*---
description: Reading a getter can invalidate a captured binding's no-NaN fact.
features: [ts-proof-whole-number, ts-route-accessor, ts-functions, ts-iteration, ts-numbers, ts-accessors, ts-objects, ts-closures]
---*/
// Fact: the captured binding begins whole with NaN excluded (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the property read invokes a writer getter; node observes NaN afterwards.
function afterGetter(n: number): number {
  let value = 1;
  const object = {
    get touch(): number {
      if (n > 0) value = NaN;
      return 0;
    }
  };
  object.touch;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterGetter(n), n > 0 ? NaN : 1);
}
