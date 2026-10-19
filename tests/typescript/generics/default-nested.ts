/*---
description: A class whose type parameter defaults to a nested generic is used without a type argument.
features: [ts-generics, ts-generic-defaults, ts-class]
---*/
class Box<T> {
  constructor(public value: T) {}
}
class Queue<T = Box<Box<number>>> {
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
const first: Box<Box<number>> = new Box(new Box(4));
const second: Box<Box<number>> = new Box(new Box(9));
queue.push(first).push(second);
assert.sameValue(queue.size, 2);
const head = queue.shift();
assert.sameValue(head, first);
if (head !== undefined) assert.sameValue(head.value.value, 4);
assert.sameValue(queue.shift(), second);
assert.sameValue(queue.shift(), undefined);
