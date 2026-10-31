/*---
description: Control for reflection-apply-max-parameter; remove the reflected route.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-function-types, ts-numbers, ts-tuples, ts-destructuring]
---*/
// Paired case: ../builtin-identity/reflection-apply-max-parameter.ts.
// Control: Reflect.apply(target, undefined, [a, b]) becomes target(a, b).
let calls = 0;
function ownMax(a: number, b: number): number { calls++; return 100 + a - b; }
function run(target: (a: number, b: number) => number, a: number, b: number): number {
  const result: unknown = target(a, b);
  if (typeof result !== "number") throw new Test262Error("numeric result required");
  return result;
}
const inputs: [number, number][] = [[-5, 2], [7, 1], [3, 3]];
for (const [a, b] of inputs) {
  calls = 0;
  assert.sameValue(run(Math.max, a, b), a > b ? a : b);
  assert.sameValue(calls, 0);
  assert.sameValue(run(ownMax, a, b), 100 + a - b);
  assert.sameValue(calls, 1);
}
