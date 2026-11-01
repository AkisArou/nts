/*---
description: Control for read-for-each-sparse-union; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-arrow-functions]
---*/
// Paired case: ../array-contents/read-for-each-sparse-union.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const seen: unknown[] = [], types: string[] = [], indices: number[] = [];
  xs.forEach((value, index, array) => {
    assert.sameValue(array, xs);
    assert.sameValue(Object.hasOwn(array, index), true); assert.sameValue(index in array, true);
    seen.push(value); types.push(typeof value); indices.push(index);
  });
  assert.compareArray(seen, [n + 1, -0, NaN, text, undefined]);
  assert.compareArray(types, ["number", "number", "number", "string", "undefined"]);
  assert.compareArray(indices, [0, 1, 2, 3, 5]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
