/*---
description: Control for iteration-truncate-for-of; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-iteration, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-unknown, ts-null-undefined]
---*/
// Only the original array declaration changes; mutation and all observations are identical.
function cut(values: (number | string)[], text: string): void { values[1] = text; values.length = 2; }
function check(n: number): void {
  const values: (number | string)[] = [n, -0, NaN, n + 1];
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  const text = "kept:" + n;
  for (const value of values) {
    seen.push(value); types.push(typeof value); sizes.push(values.length);
    if (seen.length === 1) cut(values, text);
  }
  assert.compareArray(seen, [n, text]); assert.compareArray(types, ["number", "string"]);
  assert.compareArray(sizes, [4, 2]); assert.sameValue(values.length, 2);
  assert.sameValue<unknown>(values[1], text); assert.sameValue(typeof values[1], "string");
  for (let i = 0; i < 4; i++) {
    assert.sameValue(Object.hasOwn(values, i), i < 2); assert.sameValue(i in values, i < 2);
    if (i >= 2) { assert.sameValue(values[i], undefined); assert.sameValue(typeof values[i], "undefined"); }
  }
}
for (const n of [1, 4, 11]) check(n);
