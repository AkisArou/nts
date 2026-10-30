/*---
description: Unary conversion can replace a small integer with a value requiring double rounding.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures]
---*/
// Fact: the captured binding begins with whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: unary plus runs the writer hook; node's later increment at 2^53 has difference 0.
function afterConversion(n: number): number {
  let value = 1;
  const object = {
    valueOf(): number {
      if (n > 0) value = 9007199254740992;
      return 0;
    }
  };
  +object;
  return (value + 1) - value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? 0 : 1);
}
