/*---
description: ToSorted through a Float64Array parameter orders signed zeros and NaN without mutating its source.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers]
---*/
// Read with toSorted through a typed parameter; node makes an independent numeric ordering with negative zero before positive zero.
function check(view: Float64Array, n: number): void {
  view.set([NaN, 0, -0, n + 10, n + 2]);
  const result = view.toSorted();
  assert.sameValue(result.buffer === view.buffer, false);
  const before = [NaN, 0, -0, n + 10, n + 2];
  for (let i = 0; i < before.length; i++) assert.sameValue(Object.is(view[i], before[i]), true);
  view[3] = n + 11;
  const resultExpected = [-0, 0, n + 2, n + 10, NaN];
  assert.sameValue(result.length, 5);
  assert.sameValue(result.byteOffset, 0);
  assert.sameValue(result.byteLength, 40);
  for (let i = 0; i < resultExpected.length; i++) assert.sameValue(Object.is(result[i], resultExpected[i]), true);
  const expected = [NaN, 0, -0, n + 11, n + 2];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 40);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [-1, 0, 3]) check(new Float64Array(new ArrayBuffer(56), 8, 5), n);
