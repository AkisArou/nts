/*---
description: Array.from's mapper shrinks the target before its read.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before Array.from invokes its mapper.
// Array.from's mapper shrinks the target before its read.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    Array.from([0, 1], (step) => { if (step === 0 && change > 0) xs.length = 3; return step; });
    return xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
