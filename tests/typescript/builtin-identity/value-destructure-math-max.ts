/*---
description: A typed destructuring binding preserves Math.max as a function value.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-destructuring, ts-functions, ts-function-types, ts-tuples, ts-numbers]
---*/
// Route: destructuring gives max a typed function binding; node calls the original Math.max.
const { max }: { max: (...values: number[]) => number } = Math;
function check(left: number, right: number): void {
  assert.sameValue(max(left, right), left > right ? left : right);
}
const inputs: [number, number][] = [[-8, -3], [0, 4], [7, 2], [2.5, 2.25]];
for (const [left, right] of inputs) check(left, right);
