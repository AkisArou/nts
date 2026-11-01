/*---
description: Control for methods-index-of-parameter; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers]
---*/
// Paired case: ../typed-array-contents/methods-index-of-parameter.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Float64Array = new Float64Array(new ArrayBuffer(56), 8, 5);
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
for (const n of [2, 9, 2147483649]) check(n);
