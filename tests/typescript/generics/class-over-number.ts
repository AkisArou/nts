/*---
description: A generic class instantiated at number holds, swaps and returns its values.
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
const first: number = 2;
const second: number = 5;
const cell = new Cell<number>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<number>[] = [new Cell<number>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(a * 10, 20);
assert.sameValue(b * 10, 50);
