/*---
description: A back edge changes the target while the ordinary apply argument array grows each iteration.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-arrays, ts-rest-parameters]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the back edge carries doubled to a later variable-arity apply; node uses its new body and all arguments.
class Receiver {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
}

function total(this: Receiver, ...values: number[]): number {
  let result = this.offset;
  for (const value of values) result += value;
  return result;
}
function doubled(this: Receiver, ...values: number[]): number {
  let result = this.offset;
  for (const value of values) result += 2 * value;
  return result;
}

function afterTurns(turns: number): number {
  const receiver = new Receiver(100 + turns);
  const args: number[] = [];
  let target = total;
  let result = receiver.offset;
  for (let i = 0; i < turns; i++) {
    args.push(i + 1);
    result = target.apply(receiver, args);
    target = doubled;
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), 100 + n + (n < 2 ? n : n * (n + 1)));
}
