/*---
description: indexOf through a typed Float64Array route distinguishes NaN membership while treating signed zeros as equal.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers]
---*/
// Read with indexOf through a typed view; node compares signed zeros as equal and does not find NaN.
function check(view: Float64Array, n: number): void {
  view.set([NaN, -0, n, n + 1, NaN]);
  const queries = [NaN, -0, 0, n, n + 1, n + 2];
  const answers = [-1, 1, 1, 2, 3, -1];
  for (let i = 0; i < queries.length; i++) assert.sameValue(Object.is(view.indexOf(queries[i]), answers[i]), true);
  const expected = [NaN, -0, n, n + 1, NaN];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 40);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [2, 9, 2147483649]) check(new Float64Array(new ArrayBuffer(56), 8, 5), n);
