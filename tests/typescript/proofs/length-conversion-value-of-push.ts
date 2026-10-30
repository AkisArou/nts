/*---
description: Numeric conversion invokes a writer that changes a literal array length.
features: [ts-proof-length, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects]
---*/
// Fact: the literal has length 3 (docs/foundations/objects.md, Arrays).
// Route: Number runs valueOf and its push; node then reads 4, or unchanged 3.
function lengthAfterNumber(n: number): number {
  const xs = [10, 20, 30];
  const value = {
    valueOf(): number {
      if (n > 0) xs.push(n);
      return 1;
    }
  };
  Number(value);
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterNumber(n), n > 0 ? 4 : 3);
}
