/*---
description: Control for methods-with-parameter; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples, ts-arrow-functions, ts-errors]
---*/
// Paired case: ../typed-array-contents/methods-with-parameter.ts; same operations and assertions, with the typed route removed.
function check(n: number, expectedValue: number): void {
  const view: Uint8Array = new Uint8Array(new ArrayBuffer(6), 1, 4);
  view.set([7, 8, 9, 10]);
  const result = view.with(-2, n);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.throws(RangeError, () => view.with(4, n));
  const resultExpected = [7, 8, expectedValue, 10];
  assert.sameValue(result.length, 4);
  assert.sameValue(result.byteOffset, 0);
  assert.sameValue(result.byteLength, 4);
  for (let i = 0; i < resultExpected.length; i++) assert.sameValue(Object.is(result[i], resultExpected[i]), true);
  const expected = [7, 8, 9, 10];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 1);
  assert.sameValue(view.byteLength, 4);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[256, 0], [-1, 255], [258, 2]]) check(n, expectedValue);
