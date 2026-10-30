/*---
description: Control for length-conversion-to-string-splice; the invalidating route is removed.
features: [ts-proof-length, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-to-string]
---*/
// Paired subject: ../proofs/length-conversion-to-string-splice.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function lengthAfterString(n: number): number {
  const xs = [10, 20, 30, 40];
  const value = {
    toString(): string {
      
      return 'converted';
    }
  };
  String(value);
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterString(n), 4);
}
