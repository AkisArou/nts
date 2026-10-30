/*---
description: A caught throw leaves length 3; writing the old index 3 must restore length 4.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before a throw skips restoration of the popped slot.
// A caught throw leaves length 3; writing the old index 3 must restore length 4.
function write(change: number): number {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    try {
      xs.pop();
      if (change > 0) throw new Error("before restore");
      xs.push(44);
    } catch {}
    xs[index] = 70 + change;
    return xs.length * 100 + xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(write(change), 470 + change);
