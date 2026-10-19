/*---
description: A type parameter's default may name an earlier type parameter.
features: [ts-generics, ts-generic-defaults]
---*/
class Batch<T, C extends T[] = T[]> {
  constructor(readonly items: C) {}
  first(): T {
    return this.items[0];
  }
}
const batch = new Batch<number>([7, 8]);
assert.sameValue(batch.first(), 7);
assert.sameValue(batch.items.length, 2);
