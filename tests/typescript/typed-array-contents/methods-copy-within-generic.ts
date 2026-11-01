/*---
description: A constrained generic preserves overlapping copyWithin writes and the returned view identity.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Write with copyWithin through a constrained generic; read all slots; node copies the original overlapping sequence.
function check<V extends Uint8Array>(view: V, n: number): void {
  view.set([n, 1, 2, 3, 4]);
  const returned = view.copyWithin(1, 0, 4);
  assert.sameValue(returned, view);
  const expected = [n, n, 1, 2, 3];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 1);
  assert.sameValue(view.byteLength, 5);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0, 128, 255]) check(new Uint8Array(new ArrayBuffer(7), 1, 5), n);
