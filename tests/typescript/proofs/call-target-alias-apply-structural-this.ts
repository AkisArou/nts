/*---
description: An aliased function field accepts a structural literal receiver through apply.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-objects, ts-structural-typing]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the alias replaces add before apply receives a plain object matching Receiver; node uses its offset.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function add(this: Receiver, value: number): number { return this.offset + value; }
function doubled(this: Receiver, value: number): number { return this.offset + 2 * value; }

function afterAlias(n: number): number {
  const holder: { target: typeof add } = { target: add };
  const alias = holder;
  if (n > 0) alias.target = doubled;
  return holder.target.apply({ offset: 100 + n }, [2]);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 104 : 102) + n);
}
