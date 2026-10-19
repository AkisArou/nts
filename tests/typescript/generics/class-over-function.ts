/*---
description: A generic class instantiated at a function type holds, swaps and returns its values.
features: [ts-generics, ts-class, ts-function-types]
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
const first: (n: number) => number = (n: number) => n + 1;
const second: (n: number) => number = (n: number) => n * 3;
const cell = new Cell<(n: number) => number>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<(n: number) => number>[] = [new Cell<(n: number) => number>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(a(4), 5);
assert.sameValue(b(4), 12);
