/*---
description: A typed destructuring binding preserves Array.isArray over unknown inputs.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-destructuring, ts-functions, ts-function-types, ts-tuples, ts-unknown, ts-arrays]
---*/
// Route: destructuring gives isArray a typed function binding; node distinguishes arrays from array-like objects.
const { isArray }: { isArray: (value: unknown) => boolean } = Array;
function check(value: unknown, expected: boolean): void {
  assert.sameValue(isArray(value), expected);
}
const inputs: [unknown, boolean][] = [
  [[], true], [[1, 2], true], [{ 0: 1, length: 1 }, false], [null, false], ["ab", false]
];
for (const [value, expected] of inputs) check(value, expected);
