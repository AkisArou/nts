/*---
description: A generic class instantiated at a nested generic holds, swaps and returns its values.
features: [ts-generics, ts-class]
---*/
class Box<T> {
  constructor(public value: T) {}
}
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
const first: Box<Box<number>> = new Box(new Box(4));
const second: Box<Box<number>> = new Box(new Box(9));
const cell = new Cell<Box<Box<number>>>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<Box<Box<number>>>[] = [new Cell<Box<Box<number>>>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(a.value.value, 4);
assert.sameValue(b.value.value, 9);
