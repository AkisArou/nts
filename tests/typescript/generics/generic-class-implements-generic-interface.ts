/*---
description: A generic class implements a generic interface; values of the interface type dispatch to it at two types.
features: [ts-generics, ts-class, ts-interfaces]
---*/
interface Source<T> {
  next(): T | undefined;
}
class ArraySource<T> implements Source<T> {
  private index = 0;
  constructor(private items: T[]) {}
  next(): T | undefined {
    return this.items[this.index++];
  }
}
function drain<T>(source: Source<T>): T[] {
  const out: T[] = [];
  for (let item = source.next(); item !== undefined; item = source.next()) out.push(item);
  return out;
}
assert.compareArray(drain(new ArraySource([3, 1, 2])), [3, 1, 2]);
assert.compareArray(drain(new ArraySource(["z"])), ["z"]);
