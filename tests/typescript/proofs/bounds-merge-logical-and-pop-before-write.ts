/*---
description: The taken pop makes old index 3 append; the write must restore length 4.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-expressions]
---*/
// docs/foundations/objects.md, Arrays: the guard proves index 3 in range before the short-circuit merge.
// The taken pop makes old index 3 append; the write must restore length 4.
function write(change: number): number {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    change > 0 && xs.pop();
    xs[index] = 70 + change;
    return xs.length * 100 + xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 3]) assert.sameValue(write(change), 470 + change);
