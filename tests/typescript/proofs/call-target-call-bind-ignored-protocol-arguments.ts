/*---
description: A callback protocol binds all its arguments when the actual target consumes fewer.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-type-aliases]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: a call changes the target passed to bindVisitor; node ignores surplus bound arguments in the selected body.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

type Visitor = (this: Receiver, value: number, index: number, count: number) => number;
function valueOnly(this: Receiver, value: number): number { return this.offset + value; }
function withIndex(this: Receiver, value: number, index: number): number { return this.offset + 2 * value + index; }
function bindVisitor(target: Visitor, receiver: Receiver, value: number): () => number {
  return target.bind(receiver, value, 4, 9);
}
function choose(target: Visitor, n: number): Visitor { return n > 0 ? withIndex : target; }
function afterCall(n: number): number {
  const receiver = new Receiver(100 + n);
  let target: Visitor = valueOnly;
  target = choose(target, n);
  return bindVisitor(target, receiver, n)();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), n > 0 ? 104 + 3 * n : 100 + 2 * n);
}
