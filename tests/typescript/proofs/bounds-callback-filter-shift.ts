/*---
description: filter's predicate shrinks the target before its old last read.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the filter predicate shifts its array.
// filter's predicate shrinks the target before its old last read.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    [0, 1].filter((step) => { if (step === 0 && change > 0) xs.shift(); return true; });
    return xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
