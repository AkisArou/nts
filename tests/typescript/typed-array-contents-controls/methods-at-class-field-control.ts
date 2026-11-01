/*---
description: Control for methods-at-class-field; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-null-undefined, ts-class, ts-class-fields]
---*/
// Paired case: ../typed-array-contents/methods-at-class-field.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Float64Array = new Float64Array(new ArrayBuffer(56), 8, 5);
  view.set([NaN, -0, n, 0, n + 1]);
  const indices = [-6, -5, -4, -1, 0, 4, 5];
  const answers = [undefined, NaN, -0, n + 1, NaN, n + 1, undefined];
  for (let i = 0; i < indices.length; i++) assert.sameValue(Object.is(view.at(indices[i]), answers[i]), true);
  const expected = [NaN, -0, n, 0, n + 1];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 40);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [2, 9, 2147483649]) check(n);
