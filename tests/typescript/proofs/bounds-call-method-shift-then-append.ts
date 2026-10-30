/*---
description: A method shifts length 4 to 3; writing at old index 3 must append.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-class, ts-class-fields]
---*/
// docs/foundations/objects.md, Arrays: a guard proves index 3 inside the field array before its method call.
// A method shifts length 4 to 3; writing at old index 3 must append.
class Box {
  xs: number[] = [11, 22, 33, 44];
  change(n: number): void { if (n > 0) this.xs.shift(); }
}
function write(change: number): number {
  const box = new Box();
  const index = 3;
  if (index < box.xs.length) {
    box.change(change);
    box.xs[index] = 70 + change;
    return box.xs.length * 100 + box.xs[0] + box.xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(write(change), (change > 0 ? 492 : 481) + change);
