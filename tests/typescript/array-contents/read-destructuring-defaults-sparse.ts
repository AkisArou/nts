/*---
description: Destructuring defaults distinguish undefined reads from retained mixed values through a narrow numeric array.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-destructuring]
---*/
// Write through a union alias; read through destructuring with defaults for holes, stored undefined and past-end positions; node preserves actual values and sparse-slot behavior.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: number[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const [first, zero, nan, value, hole = "hole:" + n, stored = "stored:" + n, past = "past:" + n] = xs;
  assert.compareArray<unknown>([first, zero, nan, value, hole, stored, past], [n + 1, -0, NaN, text, "hole:" + n, "stored:" + n, "past:" + n]);
  assert.compareArray([typeof first, typeof zero, typeof nan, typeof value, typeof hole, typeof stored, typeof past], ["number", "number", "number", "string", "string", "string", "string"]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
