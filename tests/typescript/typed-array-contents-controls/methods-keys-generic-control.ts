/*---
description: Control for methods-keys-generic; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/methods-keys-generic.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Int16Array = new Int16Array(new ArrayBuffer(14), 4, 4);
  view.set([-32768, -1, n, 32767]);
  const seen: number[] = [];
  for (const key of view.keys()) seen.push(key);
  assert.sameValue(seen.length, 4);
  for (let i = 0; i < seen.length; i++) assert.sameValue(Object.is(seen[i], i), true);
  const expected = [-32768, -1, n, 32767];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 4);
  assert.sameValue(view.byteLength, 8);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0, 1, 32767]) check(n);
