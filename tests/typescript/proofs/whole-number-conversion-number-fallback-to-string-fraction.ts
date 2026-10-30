/*---
description: Number conversion fallback can invalidate a whole-number fact.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-to-string]
---*/
// Fact: the captured binding begins with whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: non-primitive valueOf falls back to toString; node reads its written 3.5.
function afterConversion(n: number): number {
  let value = 1;
  const object = {
    valueOf(): object { return {}; },
    toString(): string {
      if (n > 0) value = 3.5;
      return "0";
    }
  };
  Number(object);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? 3.5 : 1);
}
