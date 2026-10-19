/*---
description: A generic class instantiated at boolean holds, swaps and returns its values.
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
const first: boolean = true;
const second: boolean = false;
const cell = new Cell<boolean>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<boolean>[] = [new Cell<boolean>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(a ? "yes" : "no", "yes");
assert.sameValue(b ? "yes" : "no", "no");
