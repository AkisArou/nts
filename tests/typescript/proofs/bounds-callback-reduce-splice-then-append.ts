/*---
description: A reducer deletes index 3; the subsequent write must append and restore length 4.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the reducer deletes that slot.
// A reducer deletes index 3; the subsequent write must append and restore length 4.
function write(change: number): number {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    [0, 1].reduce((sum, step) => { if (step === 0 && change > 0) xs.splice(3, 1); return sum + step; }, 0);
    xs[index] = 70 + change;
    return xs.length * 100 + xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(write(change), 470 + change);
