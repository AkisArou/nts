/*---
description: A throw skips restoration of index 4; the read is undefined.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 starts in range before a throw can skip its restoration.
// A throw skips restoration of index 4; the read is undefined.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let index = 0;
  try {
    index = 4;
    if (change > 0) throw new Error("before restore");
    index = 0;
  } catch {}
  return xs[index];
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 11);
