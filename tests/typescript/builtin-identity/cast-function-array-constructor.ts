/*---
description: An array-returning function cast to ArrayConstructor keeps its returned elements.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-arrays, ts-instanceof]
---*/
// Route: a function is asserted to be Array; new uses the array returned by the function.
let calls = 0;
function ownArray(n: number): number[] { calls++; return [n + 100, n + 101]; }
function check(n: number): void {
  calls = 0;
  const Target = ownArray as unknown as typeof Array;
  const value = new Target<number>(n);
  assert.sameValue(calls, 1);
  assert.sameValue(value.length, 2);
  assert.sameValue<unknown>(value[0], n + 100);
  assert.sameValue<unknown>(value[1], n + 101);
  assert.sameValue(value instanceof ownArray, false);
  assert.sameValue(value instanceof Array, true);
}
for (const n of [0, 1, 3, 7]) check(n);
