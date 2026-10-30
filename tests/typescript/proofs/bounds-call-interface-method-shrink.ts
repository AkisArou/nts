/*---
description: A dispatched mutator removes the guarded element.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-class, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the interface-dispatched mutation.
// A dispatched mutator removes the guarded element.
interface Mutator { change(xs: number[]): void; }
class Keep implements Mutator { change(xs: number[]): void { xs[0] = 55; } }
class Shrink implements Mutator { change(xs: number[]): void { xs.pop(); } }
function read(mutator: Mutator): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) { mutator.change(xs); return xs[index]; }
  return -1;
}
for (const mode of [-1, 0, 1, 3]) {
  assert.sameValue(read(mode > 0 ? new Shrink() : new Keep()), mode > 0 ? undefined : 44);
}
