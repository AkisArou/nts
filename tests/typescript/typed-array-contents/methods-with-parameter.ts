/*---
description: With through a Uint8Array parameter converts the replacement and preserves the original view.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples, ts-arrow-functions, ts-errors]
---*/
// Copy with a negative index through a typed view; node wraps the replacement byte and leaves the source unchanged.
function check(view: Uint8Array, n: number, expectedValue: number): void {
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
for (const [n, expectedValue] of [[256, 0], [-1, 255], [258, 2]]) check(new Uint8Array(new ArrayBuffer(6), 1, 4), n, expectedValue);
