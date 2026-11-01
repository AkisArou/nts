/*---
description: Control for methods-sort-interface; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces]
---*/
// Paired case: ../typed-array-contents/methods-sort-interface.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Float64Array = new Float64Array(new ArrayBuffer(64), 8, 6);
  view.set([NaN, 10 + n, 0, -0, 2 + n, -Infinity]);
  const returned = view.sort();
  assert.sameValue(returned, view);
  const expected = [-Infinity, -0, 0, 2 + n, 10 + n, NaN];
  assert.sameValue(view.length, 6);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 48);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [-1, 0, 3]) check(n);
