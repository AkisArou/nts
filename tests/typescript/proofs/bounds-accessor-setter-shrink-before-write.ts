/*---
description: A setter shrinks length 4 to 3; writing at old index 3 must append.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the setter removes its slot.
// A setter shrinks length 4 to 3; writing at old index 3 must append.
function write(change: number): number {
  const xs = [11, 22, 33, 44];
  const hook = { set effect(n: number) { if (n > 0) xs.length = 3; } };
  const index = 3;
  if (index < xs.length) {
    hook.effect = change;
    xs[index] = 70 + change;
    return xs.length * 100 + xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(write(change), 470 + change);
