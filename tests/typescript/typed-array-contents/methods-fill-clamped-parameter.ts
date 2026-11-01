/*---
description: Fill through a Uint8ClampedArray parameter applies clamping and round-half-to-even.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples]
---*/
// Write with fill through a clamped-view parameter; node converts each stored element and preserves slots outside the range.
function check(view: Uint8ClampedArray, n: number, expectedValue: number): void {
  view.set([7, 8, 9, 10, 11]);
  const returned = view.fill(n, 1, 4);
  assert.sameValue(returned, view);
  const expected = [7, expectedValue, expectedValue, expectedValue, 11];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 1);
  assert.sameValue(view.byteLength, 5);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[2.5, 2], [3.5, 4], [NaN, 0], [-Infinity, 0], [Infinity, 255]]) check(new Uint8ClampedArray(new ArrayBuffer(7), 1, 5), n, expectedValue);
