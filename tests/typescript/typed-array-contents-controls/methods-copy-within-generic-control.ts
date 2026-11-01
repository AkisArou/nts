/*---
description: Control for methods-copy-within-generic; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/methods-copy-within-generic.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Uint8Array = new Uint8Array(new ArrayBuffer(7), 1, 5);
  view.set([n, 1, 2, 3, 4]);
  const returned = view.copyWithin(1, 0, 4);
  assert.sameValue(returned, view);
  const expected = [n, n, 1, 2, 3];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 1);
  assert.sameValue(view.byteLength, 5);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0, 128, 255]) check(n);
