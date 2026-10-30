/*---
description: A nested-array alias pops length 4 to 3; old index 3 must append.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before a nested array alias removes it.
// A nested-array alias pops length 4 to 3; old index 3 must append.
function write(change: number): number {
  const xs = [11, 22, 33, 44];
  const nested = [xs];
  const index = 3;
  if (index < xs.length) {
    if (change > 0) nested[0].pop();
    xs[index] = 70 + change;
    return xs.length * 100 + xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(write(change), 470 + change);
