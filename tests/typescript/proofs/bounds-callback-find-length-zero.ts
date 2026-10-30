/*---
description: find's predicate empties the guarded array.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before find invokes its predicate.
// find's predicate empties the guarded array.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 0;
  if (index < xs.length) {
    [0, 1].find((step) => { if (change > 0) xs.length = 0; return step === 0; });
    return xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 11);
