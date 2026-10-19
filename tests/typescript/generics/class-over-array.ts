/*---
description: A generic class instantiated at an array type holds, swaps and returns its values.
features: [ts-generics, ts-class]
---*/
class Cell<T> {
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  swap(next: T): T {
    const old = this.value;
    this.value = next;
    return old;
  }
}
const first: number[] = [1, 2, 3];
const second: number[] = [10];
const cell = new Cell<number[]>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<number[]>[] = [new Cell<number[]>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(a.length + a[0], 4);
assert.sameValue(b.length + b[0], 11);
