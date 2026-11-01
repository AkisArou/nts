/*---
description: ToReversed through a constrained floating-view generic preserves signed zero and NaN in a copy.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Read with toReversed through a generic view; node reverses exact elements into separate storage.
function check<V extends Float64Array>(view: V, n: number): void {
  view.set([n, -0, NaN, Infinity]);
  const result = view.toReversed();
  assert.sameValue(result.buffer === view.buffer, false);
  const before = [n, -0, NaN, Infinity];
  for (let i = 0; i < before.length; i++) assert.sameValue(Object.is(view[i], before[i]), true);
  view[0] = n + 1;
  const resultExpected = [Infinity, NaN, -0, n];
  assert.sameValue(result.length, 4);
  assert.sameValue(result.byteOffset, 0);
  assert.sameValue(result.byteLength, 32);
  for (let i = 0; i < resultExpected.length; i++) assert.sameValue(Object.is(result[i], resultExpected[i]), true);
  const expected = [n + 1, -0, NaN, Infinity];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 32);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0.1, 2, 2147483649]) check(new Float64Array(new ArrayBuffer(48), 8, 4), n);
