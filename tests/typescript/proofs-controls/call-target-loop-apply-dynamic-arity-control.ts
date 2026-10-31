/*---
description: The apply target stays total while the ordinary argument array grows each iteration.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-arrays, ts-rest-parameters]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Control: paired with proofs/call-target-loop-apply-dynamic-arity.ts; only target replacement is removed.
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
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), 100 + n + n * (n + 1) / 2);
}
