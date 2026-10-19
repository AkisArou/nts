/*---
description: A class extending a generic class at a fixed type argument inherits its members at that type.
features: [ts-generics, ts-class, ts-inheritance]
---*/
class Stack<T> {
  protected items: T[] = [];
  push(item: T): void {
    this.items.push(item);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
}
class NumberStack extends Stack<number> {
  sum(): number {
    return this.items.reduce((a, b) => a + b, 0);
  }
}
const stack = new NumberStack();
stack.push(4);
stack.push(6);
assert.sameValue(stack.sum(), 10);
assert.sameValue(stack.pop(), 6);
assert.sameValue(stack.sum(), 4);
