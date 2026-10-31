/*---
description: A field alias selects callbacks that ignore different numbers of bound protocol arguments.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-type-aliases, ts-objects]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the alias replaces a zero-argument target with a one-argument target before binding the full protocol.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

type Visitor = (this: Receiver, value: number, index: number, count: number) => number;
function offsetOnly(this: Receiver): number { return this.offset + 5; }
function withValue(this: Receiver, value: number): number { return this.offset + value; }
function afterAlias(n: number): number {
  const receiver = new Receiver(100 + n);
  const holder: { target: Visitor } = { target: offsetOnly };
  const alias = holder;
  if (n > 0) alias.target = withValue;
  const bound = holder.target.bind(receiver, n, 4, 9);
  return bound();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), n > 0 ? 100 + 2 * n : 105 + n);
}
