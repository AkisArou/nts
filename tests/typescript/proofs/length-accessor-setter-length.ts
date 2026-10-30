/*---
description: A setter changes an allocation length before the following read.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: a setter assigns length 1; node reads 1, or unchanged 4.
function lengthAfterSetter(n: number): number {
  const xs = [10, 20, 30, 40];
  const hook = {
    set size(value: number) {
      if (value > 0) xs.length = 1;
    }
  };
  hook.size = n;
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterSetter(n), n > 0 ? 1 : 4);
}
