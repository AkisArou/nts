/*---
description: Control for methods-filter-union; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-arrow-functions, ts-unions]
---*/
// Paired case: ../typed-array-contents/methods-filter-union.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Float64Array = new Float64Array(new ArrayBuffer(64), 8, 6);
  view.set([NaN, -0, n, -1, 0, Infinity]);
  const seen: number[] = [], indices: number[] = [];
  const result = view.filter((value, index, array) => {
    assert.sameValue(array, view);
    seen.push(value); indices.push(index);
    return value >= 0 || Number.isNaN(value);
  });
  assert.compareArray(indices, [0, 1, 2, 3, 4, 5]);
  const visited = [NaN, -0, n, -1, 0, Infinity];
  for (let i = 0; i < visited.length; i++) assert.sameValue(Object.is(seen[i], visited[i]), true);
  assert.sameValue(result.buffer === view.buffer, false);
  for (let i = 0; i < visited.length; i++) assert.sameValue(Object.is(view[i], visited[i]), true);
  view[2] = n + 1;
  const resultExpected = [NaN, -0, n, 0, Infinity];
  assert.sameValue(result.length, 5);
  assert.sameValue(result.byteOffset, 0);
  assert.sameValue(result.byteLength, 40);
  for (let i = 0; i < resultExpected.length; i++) assert.sameValue(Object.is(result[i], resultExpected[i]), true);
  const expected = [NaN, -0, n + 1, -1, 0, Infinity];
  assert.sameValue(view.length, 6);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 48);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [2, 9, 2147483649]) check(n);
