/*---
description: Control for methods-fill-clamped-parameter; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples]
---*/
// Paired case: ../typed-array-contents/methods-fill-clamped-parameter.ts; same operations and assertions, with the typed route removed.
function check(n: number, expectedValue: number): void {
  const view: Uint8ClampedArray = new Uint8ClampedArray(new ArrayBuffer(7), 1, 5);
  view.set([7, 8, 9, 10, 11]);
  const returned = view.fill(n, 1, 4);
  assert.sameValue(returned, view);
  const expected = [7, expectedValue, expectedValue, expectedValue, 11];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 1);
  assert.sameValue(view.byteLength, 5);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[2.5, 2], [3.5, 4], [NaN, 0], [-Infinity, 0], [Infinity, 255]]) check(n, expectedValue);
