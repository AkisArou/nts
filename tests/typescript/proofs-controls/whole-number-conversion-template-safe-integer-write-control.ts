/*---
description: Control for whole-number-conversion-template-safe-integer-write; the invalidating route is removed.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-template-literals, ts-to-string]
---*/
// Paired subject: ../proofs/whole-number-conversion-template-safe-integer-write.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function afterConversion(n: number): number {
  let value = 9007199254740991;
  const object = {
    toString(): string {
      
      return "ok";
    }
  };
  `${object}`;
  return (value + 1) - value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), 1);
}
