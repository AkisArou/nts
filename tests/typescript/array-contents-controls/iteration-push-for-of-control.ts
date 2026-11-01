/*---
description: Control for iteration-push-for-of; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-iteration, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-unknown]
---*/
// Only the original array declaration changes; mutation and all observations are identical.
function append(values: (number | string)[], text: string): void { values.push(text); }
function check(n: number): void {
  const values: (number | string)[] = [n, -0, NaN];
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  const text = "added:" + n;
  for (const value of values) {
    seen.push(value); types.push(typeof value); sizes.push(values.length);
    if (seen.length === 1) append(values, text);
  }
  assert.compareArray(seen, [n, -0, NaN, text]);
  assert.compareArray(types, ["number", "number", "number", "string"]);
  assert.compareArray(sizes, [3, 4, 4, 4]); assert.sameValue(values.length, 4);
  assert.sameValue<unknown>(values[3], text); assert.sameValue(typeof values[3], "string");
  for (let i = 0; i < values.length; i++) {
    assert.sameValue(Object.hasOwn(values, i), true); assert.sameValue(i in values, true);
  }
}
for (const n of [1, 4, 11]) check(n);
