/*---
description: Control for negative-zero-conversion-template-to-string-writes-sign; the invalidating route is removed.
features: [ts-proof-negative-zero, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-template-literals, ts-to-string]
---*/
// Paired subject: ../proofs/negative-zero-conversion-template-to-string-writes-sign.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function afterConversion(n: number): number {
  let value = 0;
  const object = {
    toString(): string {
      
      return "ok";
    }
  };
  `${object}`;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), 0);
}
