/*---
description: A numeric conversion hook invalidates the prior integer fact of another binding.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures]
---*/
// Fact: the binding begins with a whole int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Number calls valueOf before the read; node observes the hook's numeric update.
function afterConversion(n: number): number {
  let value = 1;
  const object = {
    valueOf(): number {
      if (n > 0) value = 3.5;
      return 0;
    }
  };
  Number(object);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? 3.5 : 1);
}
