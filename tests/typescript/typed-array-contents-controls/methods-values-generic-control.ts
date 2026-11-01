/*---
description: Control for methods-values-generic; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/methods-values-generic.ts; same operations and assertions, with the typed route removed.
function check(n: number): void {
  const view: Float64Array = new Float64Array(new ArrayBuffer(48), 8, 4);
  view.set([n, -0, NaN, Infinity]);
  const seen: number[] = [];
  for (const value of view.values()) seen.push(value);
  assert.sameValue(seen.length, 4);
  const visited = [n, -0, NaN, Infinity];
  for (let i = 0; i < visited.length; i++) assert.sameValue(Object.is(seen[i], visited[i]), true);
  const expected = [n, -0, NaN, Infinity];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 32);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0.1, 2, 2147483649]) check(n);
