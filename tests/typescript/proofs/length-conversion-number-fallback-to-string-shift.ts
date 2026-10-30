/*---
description: A numeric conversion fallback to toString can shorten a captured array.
features: [ts-proof-length, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: nonprimitive valueOf forces toString, whose shift makes node read 3.
function lengthAfterFallback(n: number): number {
  const xs = [10, 20, 30, 40];
  const value = {
    valueOf(): object { return {}; },
    toString(): string {
      if (n > 0) xs.shift();
      return '1';
    }
  };
  Number(value);
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterFallback(n), n > 0 ? 3 : 4);
}
