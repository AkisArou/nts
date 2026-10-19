/*---
description: A generic class instantiated at a class holds, swaps and returns its values.
features: [ts-generics, ts-class]
---*/
class Coin {
  constructor(public cents: number) {}
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
const first: Coin = new Coin(5);
const second: Coin = new Coin(25);
const cell = new Cell<Coin>(first);
assert.sameValue(cell.get(), first);
assert.sameValue(cell.swap(second), first);
assert.sameValue(cell.get(), second);
const cells: Cell<Coin>[] = [new Cell<Coin>(first), cell];
const a = cells[0].get();
const b = cells[1].get();
assert.sameValue(a.cents, 5);
assert.sameValue(b.cents, 25);
