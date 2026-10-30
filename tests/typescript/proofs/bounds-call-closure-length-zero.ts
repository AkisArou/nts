/*---
description: A captured literal array becomes empty; its old safe index is undefined.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before calling the captured mutator.
// A captured literal array becomes empty; its old safe index is undefined.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 0;
  function clear(): void { if (change > 0) xs.length = 0; }
  if (index < xs.length) { clear(); return xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 11);
