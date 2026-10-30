/*---
description: A string conversion hook invalidates a previously whole captured binding.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-to-string]
---*/
// Fact: the captured binding begins with whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: String calls toString before the read; node retains the numeric update.
function afterConversion(n: number): number {
  let value = 1;
  const object = {
    toString(): string {
      if (n > 0) value = NaN;
      return "ok";
    }
  };
  String(object);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? NaN : 1);
}
