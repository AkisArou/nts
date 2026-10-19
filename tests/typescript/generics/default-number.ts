/*---
description: A class whose type parameter defaults to number is used without a type argument.
features: [ts-generics, ts-generic-defaults, ts-class]
---*/
class Queue<T = number> {
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
const first: number = 2;
const second: number = 5;
queue.push(first).push(second);
assert.sameValue(queue.size, 2);
const head = queue.shift();
assert.sameValue(head, first);
if (head !== undefined) assert.sameValue(head * 10, 20);
assert.sameValue(queue.shift(), second);
assert.sameValue(queue.shift(), undefined);
