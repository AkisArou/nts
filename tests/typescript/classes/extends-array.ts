/*---
description: A class extending Array keeps array behaviour, and map returns an instance of the subclass.
features: [ts-class, ts-inheritance, ts-builtin-subclass]
---*/
class Stack extends Array<number> {
  top(): number | undefined {
    return this[this.length - 1];
  }
}
const stack = new Stack();
stack.push(1, 2, 3);
assert.sameValue(stack.length, 3);
assert.sameValue(stack.top(), 3);
assert.sameValue(Array.isArray(stack), true);
const doubled = stack.map((n) => n * 2);
assert.sameValue(doubled instanceof Stack, true);
assert.sameValue((doubled as Stack).top(), 6);
