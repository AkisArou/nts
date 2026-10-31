/*---
description: A joined function target accepts a structural literal receiver through call.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-objects, ts-structural-typing]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the branch replaces add before call receives a plain object matching Receiver; node uses its offset.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function add(this: Receiver, value: number): number { return this.offset + value; }
function doubled(this: Receiver, value: number): number { return this.offset + 2 * value; }

function afterChoice(n: number): number {
  let target = add;
  if (n > 0) target = doubled;
  return target.call({ offset: 100 + n }, 2);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterChoice(n), (n > 0 ? 104 : 102) + n);
}
