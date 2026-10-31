/*---
description: A joined target binds arguments into a real numeric rest parameter and keeps its receiver.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-rest-parameters, ts-arrays]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the branch replaces total with weighted before binding into tail; node calls the selected body.
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

function afterChoice(n: number): number {
  const receiver = new Receiver(100 + n);
  let target = total;
  if (n > 0) target = weighted;
  const bound = target.bind(receiver, n, 1, 2);
  return bound(3, 4);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterChoice(n), n > 0 ? 130 + 3 * n : 110 + 2 * n);
}
