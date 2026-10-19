/*---
description: A constrained generic reads the member its constraint promises.
features: [ts-generics, ts-interfaces]
---*/
interface Sized {
  size: number;
}
function total<T extends Sized>(items: T[]): number {
  let sum = 0;
  for (const item of items) sum += item.size;
  return sum;
}
assert.sameValue(total([{ size: 2 }, { size: 5 }]), 7);
