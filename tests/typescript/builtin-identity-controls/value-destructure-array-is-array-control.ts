/*---
description: Control for value-destructure-array-is-array; call Array.isArray directly instead of its destructured binding.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-destructuring, ts-functions, ts-function-types, ts-tuples, ts-unknown, ts-arrays]
---*/
// Paired case: ../builtin-identity/value-destructure-array-is-array.ts.
// Change: Call Array.isArray directly instead of its destructured binding.
const { isArray }: { isArray: (value: unknown) => boolean } = Array;
function check(value: unknown, expected: boolean): void {
  assert.sameValue(Array.isArray(value), expected);
}
const inputs: [unknown, boolean][] = [
  [[], true], [[1, 2], true], [{ 0: 1, length: 1 }, false], [null, false], ["ab", false]
];
for (const [value, expected] of inputs) check(value, expected);
