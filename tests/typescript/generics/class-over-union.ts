/*---
description: A generic class instantiated at a union holds, swaps and returns its values.
features: [ts-generics, ts-class, ts-unions]
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
const first: number | string = 7;
const second: number | string = "seven";
const cell = new Cell<number | string>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<number | string>[] = [new Cell<number | string>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(typeof a === "number" ? a + 1 : a.length, 8);
assert.sameValue(typeof b === "number" ? b + 1 : b.length, 5);
