/*---
description: Map through a Float32Array parameter rounds callback results and allocates an independent view.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-arrow-functions]
---*/
// Map a typed Float32Array parameter; node visits every slot, rounds the result to float32, and copies storage.
function check(view: Float32Array, n: number): void {
  view.set([0.5, -0, n, 1]);
  const seen: number[] = [], indices: number[] = [];
  const result = view.map((value, index, array) => {
    assert.sameValue(array, view);
    seen.push(value); indices.push(index);
    return index === 0 ? value + 0.1 : value;
  });
  assert.compareArray(indices, [0, 1, 2, 3]);
  const visited = [0.5, -0, n, 1];
  for (let i = 0; i < visited.length; i++) assert.sameValue(Object.is(seen[i], visited[i]), true);
  assert.sameValue(result.buffer === view.buffer, false);
  for (let i = 0; i < visited.length; i++) assert.sameValue(Object.is(view[i], visited[i]), true);
  view[2] = n + 1;
  const resultExpected = [0.6000000238418579, -0, n, 1];
  assert.sameValue(result.length, 4);
  assert.sameValue(result.byteOffset, 0);
  assert.sameValue(result.byteLength, 16);
  for (let i = 0; i < resultExpected.length; i++) assert.sameValue(Object.is(result[i], resultExpected[i]), true);
  const expected = [0.5, -0, n + 1, 1];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 4);
  assert.sameValue(view.byteLength, 16);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [2, 4, 8]) check(new Float32Array(new ArrayBuffer(24), 4, 4), n);
