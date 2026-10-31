/*---
description: Reflect.apply retains the typed receiver and own method result.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-function-types, ts-this-parameter, ts-objects, ts-tuples, ts-destructuring]
---*/
// Route: Reflect.apply of an own method with a typed this parameter; node follows the actual value.
let calls = 0;
const math = {
  bias: 100,
  max(this: { bias: number }, a: number, b: number): number { calls++; return this.bias + a - b; }
};
function run(target: (this: { bias: number }, a: number, b: number) => number,
             receiver: { bias: number }, a: number, b: number): number {
  const result: unknown = Reflect.apply(target, receiver, [a, b]);
  if (typeof result !== "number") throw new Test262Error("numeric result required");
  return result;
}
const inputs: [number, number][] = [[-5, 2], [7, 1], [3, 3]];
for (const [a, b] of inputs) {
  calls = 0;
  math.bias = 100 + a;
  assert.sameValue(run(math.max, math, a, b), 100 + 2 * a - b);
  assert.sameValue(calls, 1);
}
