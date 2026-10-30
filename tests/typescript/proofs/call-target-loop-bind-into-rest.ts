/*---
description: A back edge replaces the target used by the next bind into a real rest parameter.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-rest-parameters, ts-arrays]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the back edge carries weighted to the next bind; node uses its different rest weights.
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

function afterTurns(turns: number): number {
  const receiver = new Receiver(100 + turns);
  let target = total;
  let result = receiver.offset;
  for (let i = 0; i < turns; i++) {
    const bound = target.bind(receiver, 2, 1, 2);
    result = bound(3);
    target = weighted;
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n === 0 ? 100 : n === 1 ? 109 : 122 + n);
}
