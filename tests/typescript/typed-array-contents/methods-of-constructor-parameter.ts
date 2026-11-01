/*---
description: Of through a typed Uint8ClampedArray constructor clamps and rounds its numeric arguments.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples]
---*/
// Call of through a constructor parameter; node applies clamping and round-half-to-even to the copied elements.
function check(factory: Uint8ClampedArrayConstructor, n: number, expectedValue: number): void {
  const view: Uint8ClampedArray = factory.of(n, -1, 300);
  const expected = [expectedValue, 0, 255];
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, 3);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[2.5, 2], [3.5, 4], [NaN, 0], [Infinity, 255]]) check(Uint8ClampedArray, n, expectedValue);
