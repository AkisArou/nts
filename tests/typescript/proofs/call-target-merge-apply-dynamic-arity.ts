/*---
description: A joined target receives an ordinary number array whose apply arity depends on the input.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-this, ts-this-parameter, ts-iteration, ts-arrays, ts-rest-parameters]
---*/
// Fact: known function targets permit direct calls (docs/foundations/objects.md, Calls).
// Route: the branch replaces total before apply receives the dynamically grown array; node calls the selected body.
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

function afterChoice(count: number): number {
  const receiver = new Receiver(100 + count);
  const args: number[] = [];
  for (let i = 0; i < count; i++) args.push(i + 1);
  let target = total;
  if (count > 1) target = doubled;
  return target.apply(receiver, args);
}
for (const n of [0, 1, 2, 3, 7]) {
  const sum = n * (n + 1) / 2;
  assert.sameValue(afterChoice(n), 100 + n + (n > 1 ? 2 * sum : sum));
}
