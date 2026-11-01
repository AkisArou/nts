/*---
description: Keys through a constrained Int16Array generic enumerate relative indices for an offset view.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Read keys through a generic view; node enumerates indices from zero rather than the backing-buffer offset.
function check<V extends Int16Array>(view: V, n: number): void {
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
for (const n of [0, 1, 32767]) check(new Int16Array(new ArrayBuffer(14), 4, 4), n);
