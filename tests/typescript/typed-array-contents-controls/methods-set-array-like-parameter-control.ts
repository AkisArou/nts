/*---
description: Control for methods-set-array-like-parameter; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-objects, ts-tuples]
---*/
// Paired case: ../typed-array-contents/methods-set-array-like-parameter.ts; same operations and assertions, with the typed route removed.
function check(n: number, expectedValue: number): void {
  const view: Uint8Array = new Uint8Array(new ArrayBuffer(9), 2, 6);
  view.set([7, 8, 9, 10, 11, 12]);
  const source: ArrayLike<number> = { 0: n, 1: -1, 2: 256, 3: NaN, length: 4 };
  view.set(source, 1);
  const expected = [7, expectedValue, 255, 0, 0, 12];
  assert.sameValue(view.length, 6);
  assert.sameValue(view.byteOffset, 2);
  assert.sameValue(view.byteLength, 6);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[0, 0], [255, 255], [256, 0], [-1, 255]]) check(n, expectedValue);
