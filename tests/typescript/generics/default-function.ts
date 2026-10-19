/*---
description: A class whose type parameter defaults to a function type is used without a type argument.
features: [ts-generics, ts-generic-defaults, ts-class, ts-function-types]
---*/
class Queue<T = (n: number) => number> {
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
const first: (n: number) => number = (n: number) => n + 1;
const second: (n: number) => number = (n: number) => n * 3;
queue.push(first).push(second);
assert.sameValue(queue.size, 2);
const head = queue.shift();
assert.sameValue(head, first);
if (head !== undefined) assert.sameValue(head(4), 5);
assert.sameValue(queue.shift(), second);
assert.sameValue(queue.shift(), undefined);
