/*---
description: A function-field alias changes the target whose actual rest arguments are bound.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-rest-parameters, ts-arrays, ts-objects]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: an alias replaces the declared target field before bind; node keeps the new rest-consuming body.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function total(this: Receiver, head: number, ...tail: number[]): number {
  let result = this.offset + head;
  for (const value of tail) result += value;
  return result;
}
function weighted(this: Receiver, head: number, ...tail: number[]): number {
  let result = this.offset + 2 * head;
  for (const value of tail) result += 3 * value;
  return result;
}

function afterAlias(n: number): number {
  const receiver = new Receiver(100 + n);
  const holder: { target: typeof total } = { target: total };
  const alias = holder;
  if (n > 0) alias.target = weighted;
  const bound = holder.target.bind(receiver, 2, n, 3);
  return bound(4);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), n > 0 ? 125 + 4 * n : 109 + 2 * n);
}
