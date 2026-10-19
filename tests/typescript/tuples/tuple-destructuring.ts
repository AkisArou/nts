/*---
description: A tuple returned from a function is destructured into typed locals, with a swap.
features: [ts-tuples, ts-destructuring]
---*/
function divide(a: number, b: number): [quotient: number, remainder: number] {
  return [Math.floor(a / b), a % b];
}
const [q, r] = divide(17, 5);
assert.sameValue(q, 3);
assert.sameValue(r, 2);
let left = "l";
let right = "r";
[left, right] = [right, left];
assert.sameValue(left + right, "rl");
