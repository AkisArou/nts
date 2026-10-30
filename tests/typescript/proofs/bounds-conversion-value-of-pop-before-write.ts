/*---
description: Number conversion pops length 4 to 3; old index 3 must append on writing.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before Number calls valueOf.
// Number conversion pops length 4 to 3; old index 3 must append on writing.
function write(change: number): number {
  const xs = [11, 22, 33, 44];
  const hook = { valueOf(): number { if (change > 0) xs.pop(); return 0; } };
  const index = 3;
  if (index < xs.length) {
    Number(hook);
    xs[index] = 70 + change;
    return xs.length * 100 + xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(write(change), 470 + change);
