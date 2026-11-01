/*---
description: Control for methods-of-constructor-parameter; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples]
---*/
// Paired case: ../typed-array-contents/methods-of-constructor-parameter.ts; same operations and assertions, with the typed route removed.
function check(n: number, expectedValue: number): void {
  const view: Uint8ClampedArray = Uint8ClampedArray.of(n, -1, 300);
  const expected = [expectedValue, 0, 255];
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, 3);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[2.5, 2], [3.5, 4], [NaN, 0], [Infinity, 255]]) check(n, expectedValue);
