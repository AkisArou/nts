/*---
description: String conversion invokes a splice before the array length is read.
features: [ts-proof-length, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-to-string]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: String runs toString and its splice; node reads 4, 3, or 1.
function lengthAfterString(n: number): number {
  const xs = [10, 20, 30, 40];
  const value = {
    toString(): string {
      if (n > 0) xs.splice(1, n);
      return 'converted';
    }
  };
  String(value);
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterString(n), n === 0 ? 4 : n === 1 ? 3 : 1);
}
