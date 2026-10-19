/*---
description: A generic class instantiated at string holds, swaps and returns its values.
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
const first: string = "ab";
const second: string = "xyz";
const cell = new Cell<string>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<string>[] = [new Cell<string>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(a.length, 2);
assert.sameValue(b.length, 3);
