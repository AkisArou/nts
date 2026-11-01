/*---
description: Control for methods-spread-union; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-spread, ts-unions]
---*/
// Paired case: ../typed-array-contents/methods-spread-union.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Float64Array = new Float64Array(new ArrayBuffer(48), 8, 4);
  view.set([n, -0, NaN, Infinity]);
  const result = [...view];
  assert.sameValue(result.length, 4);
  const copied = [n, -0, NaN, Infinity];
  for (let i = 0; i < copied.length; i++) assert.sameValue(Object.is(view[i], copied[i]), true);
  view[0] = 7;
  for (let i = 0; i < copied.length; i++) assert.sameValue(Object.is(result[i], copied[i]), true);
  const expected = [7, -0, NaN, Infinity];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 32);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0.1, 2147483649, 9007199254740994]) check(n);
