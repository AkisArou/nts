/*---
description: String conversion fallback can invalidate a whole-number fact.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures]
---*/
// Fact: the captured binding begins with whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: non-primitive toString falls back to valueOf; node reads its written 0.25.
function afterConversion(n: number): number {
  let value = 1;
  const object = {
    toString(): object { return {}; },
    valueOf(): number {
      if (n > 0) value = 0.25;
      return 0;
    }
  };
  String(object);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? 0.25 : 1);
}
