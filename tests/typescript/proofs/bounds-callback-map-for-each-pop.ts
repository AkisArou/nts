/*---
description: Map.forEach's callback removes the target's guarded last slot.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-map-set, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before Map.forEach calls the mutator.
// Map.forEach's callback removes the target's guarded last slot.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const steps = new Map<number, number>();
  steps.set(0, change);
  const index = 3;
  if (index < xs.length) {
    steps.forEach((value) => { if (value > 0) xs.pop(); });
    return xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
