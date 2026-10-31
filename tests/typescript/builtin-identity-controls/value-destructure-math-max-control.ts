/*---
description: Control for value-destructure-math-max; call Math.max directly instead of its destructured binding.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-destructuring, ts-functions, ts-function-types, ts-tuples, ts-numbers]
---*/
// Paired case: ../builtin-identity/value-destructure-math-max.ts.
// Change: Call Math.max directly instead of its destructured binding.
const { max }: { max: (...values: number[]) => number } = Math;
function check(left: number, right: number): void {
  assert.sameValue(Math.max(left, right), left > right ? left : right);
}
const inputs: [number, number][] = [[-8, -3], [0, 4], [7, 2], [2.5, 2.25]];
for (const [left, right] of inputs) check(left, right);
