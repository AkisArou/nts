/*---
description: Values through a constrained Float64Array generic preserve signed zero and NaN in iteration order.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Read values through a generic floating view; node returns the complete element sequence with exact zero signs and NaN.
function check<V extends Float64Array>(view: V, n: number): void {
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
for (const n of [0.1, 2, 2147483649]) check(new Float64Array(new ArrayBuffer(48), 8, 4), n);
