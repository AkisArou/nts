/*---
description: A class whose type parameter defaults to a union is used without a type argument.
features: [ts-generics, ts-generic-defaults, ts-class, ts-unions]
---*/
class Queue<T = number | string> {
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
const first: number | string = 7;
const second: number | string = "seven";
queue.push(first).push(second);
assert.sameValue(queue.size, 2);
const head = queue.shift();
assert.sameValue(head, first);
if (head !== undefined) assert.sameValue(typeof head === "number" ? head + 1 : head.length, 8);
assert.sameValue(queue.shift(), second);
assert.sameValue(queue.shift(), undefined);
