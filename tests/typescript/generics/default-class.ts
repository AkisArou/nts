/*---
description: A class whose type parameter defaults to a class is used without a type argument.
features: [ts-generics, ts-generic-defaults, ts-class]
---*/
class Coin {
  constructor(public cents: number) {}
}
class Queue<T = Coin> {
  private items: T[] = [];
  push(item: T): this {
    this.items.push(item);
    return this;
  }
  shift(): T | undefined {
    return this.items.shift();
  }
  get size(): number {
    return this.items.length;
  }
}
const queue = new Queue();
const first: Coin = new Coin(5);
const second: Coin = new Coin(25);
queue.push(first).push(second);
assert.sameValue(queue.size, 2);
const head = queue.shift();
assert.sameValue(head, first);
if (head !== undefined) assert.sameValue(head.cents, 5);
assert.sameValue(queue.shift(), second);
assert.sameValue(queue.shift(), undefined);
