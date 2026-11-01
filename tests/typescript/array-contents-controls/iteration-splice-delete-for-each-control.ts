/*---
description: Control for iteration-splice-delete-for-each; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-iteration, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-unknown, ts-arrow-functions, ts-null-undefined]
---*/
// Only the original array declaration changes; mutation and all observations are identical.
function check(n: number): void {
  const values: (number | string)[] = [n, n + 1, -0, NaN];
  const writer: (number | string)[] = values;
  const text = "shifted:" + n; writer[2] = text;
  const seen: unknown[] = [], types: string[] = [], indices: number[] = [], sizes: number[] = [];
  values.forEach((value, index, owner) => {
    assert.sameValue(owner, values);
    seen.push(value); types.push(typeof value); indices.push(index); sizes.push(owner.length);
    if (index === 0) writer.splice(0, 1);
  });
  assert.compareArray(seen, [n, text, NaN]); assert.compareArray(types, ["number", "string", "number"]);
  assert.compareArray(indices, [0, 1, 2]); assert.compareArray(sizes, [4, 3, 3]);
  const expected: unknown[] = [n + 1, text, NaN];
  assert.sameValue(values.length, 3); assert.compareArray(values, expected);
  for (let i = 0; i < values.length; i++) {
    assert.sameValue(typeof values[i], typeof expected[i]);
    assert.sameValue(Object.hasOwn(values, i), true); assert.sameValue(i in values, true);
  }
  assert.sameValue(values[3], undefined); assert.sameValue(typeof values[3], "undefined");
  assert.sameValue(Object.hasOwn(values, 3), false); assert.sameValue(3 in values, false);
}
for (const n of [1, 4, 11]) check(n);
