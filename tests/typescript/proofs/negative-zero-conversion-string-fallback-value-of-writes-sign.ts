/*---
description: String fallback conversion can invalidate a captured positive-zero fact.
features: [ts-proof-negative-zero, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures]
---*/
// Fact: the captured binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: non-primitive toString falls back to the valueOf writer; node later reads -0.
function afterConversion(n: number): number {
  let value = 0;
  const object = {
    toString(): object { return {}; },
    valueOf(): number {
      if (n > 0) value = -0;
      return 0;
    }
  };
  String(object);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? -0 : 0);
}
