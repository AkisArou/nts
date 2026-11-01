/*---
description: Control for methods-entries-interface; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples, ts-interfaces]
---*/
// Paired case: ../typed-array-contents/methods-entries-interface.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Uint32Array = new Uint32Array(new ArrayBuffer(20), 4, 3);
  view.set([n, 2147483648, 4294967295]);
  const indices: number[] = [], seen: number[] = [];
  for (const [index, value] of view.entries()) { indices.push(index); seen.push(value); }
  assert.sameValue(seen.length, 3); assert.sameValue(indices.length, 3);
  const visited = [n, 2147483648, 4294967295];
  for (let i = 0; i < visited.length; i++) {
    assert.sameValue(Object.is(indices[i], i), true);
    assert.sameValue(Object.is(seen[i], visited[i]), true);
  }
  const expected = [n, 2147483648, 4294967295];
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 4);
  assert.sameValue(view.byteLength, 12);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0, 1, 4294967295]) check(n);
