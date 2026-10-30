/*---
description: An index append inside a setter invalidates the array allocation length.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: a setter writes at the old end; node reads 3, or unchanged 2.
function lengthAfterSetterStore(n: number): number {
  const xs = [10, 20];
  const hook = {
    set value(value: number) {
      if (value > 0) xs[xs.length] = value;
    }
  };
  hook.value = n;
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterSetterStore(n), n > 0 ? 3 : 2);
}
