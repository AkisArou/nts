/*---
description: Splice through a union alias inserts strings during forEach while its original length limits visits.
features: [ts-array-contents, ts-array-iteration, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-unknown, ts-arrow-functions]
---*/
// A union writer mutates during narrow iteration; node returns the exact live trace below.
function check(n: number): void {
  const values: number[] = [n, n + 1, n + 2, -0, NaN];
  const writer: (number | string)[] = values;
  const seen: unknown[] = [], types: string[] = [], indices: number[] = [], sizes: number[] = [];
  const text = "inserted:" + n;
  values.forEach((value, index, owner) => {
    assert.sameValue(owner, values);
    seen.push(value); types.push(typeof value); indices.push(index); sizes.push(owner.length);
    if (index === 0) writer.splice(1, 1, text, text + "!");
  });
  assert.compareArray(seen, [n, text, text + "!", n + 2, -0]);
  assert.compareArray(types, ["number", "string", "string", "number", "number"]);
  assert.compareArray(indices, [0, 1, 2, 3, 4]); assert.compareArray(sizes, [5, 6, 6, 6, 6]);
  const expected: unknown[] = [n, text, text + "!", n + 2, -0, NaN];
  assert.sameValue(values.length, 6); assert.compareArray(values, expected);
  for (let i = 0; i < values.length; i++) {
    assert.sameValue(typeof values[i], typeof expected[i]);
    assert.sameValue(Object.hasOwn(values, i), true); assert.sameValue(i in values, true);
  }
}
for (const n of [1, 4, 11]) check(n);
