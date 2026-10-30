/*---
description: Reading a getter invalidates the length of the array it grows.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects]
---*/
// Fact: the literal has length 3 (docs/foundations/objects.md, Arrays).
// Route: a getter unshifts; node reads 4, or unchanged 3.
function lengthAfterGetter(n: number): number {
  const xs = [10, 20, 30];
  const hook = {
    get touch(): number {
      if (n > 0) xs.unshift(n);
      return 0;
    }
  };
  hook.touch;
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterGetter(n), n > 0 ? 4 : 3);
}
