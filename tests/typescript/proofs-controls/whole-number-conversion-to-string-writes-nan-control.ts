/*---
description: Control for whole-number-conversion-to-string-writes-nan; the invalidating route is removed.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-to-string]
---*/
// Paired subject: ../proofs/whole-number-conversion-to-string-writes-nan.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function afterConversion(n: number): number {
  let value = 1;
  const object = {
    toString(): string {
      
      return "ok";
    }
  };
  String(object);
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), 1);
}
