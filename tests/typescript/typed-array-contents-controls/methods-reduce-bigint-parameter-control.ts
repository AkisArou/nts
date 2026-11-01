/*---
description: Control for methods-reduce-bigint-parameter; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-arrow-functions]
---*/
// Paired case: ../typed-array-contents/methods-reduce-bigint-parameter.ts; same operations and assertions, with the typed route removed.
function check(n: bigint): void {
  const view: BigInt64Array = new BigInt64Array(new ArrayBuffer(48), 8, 4);
  view.set([n, 2n, -3n, 4n]);
  const seen: bigint[] = [], sums: bigint[] = [], indices: number[] = [];
  const result = view.reduce((sum, value, index, array) => {
    assert.sameValue(array, view);
    sums.push(sum); seen.push(value); indices.push(index);
    return sum + value;
  }, 5n);
  assert.sameValue(Object.is(result, n + 8n), true);
  assert.compareArray(indices, [0, 1, 2, 3]);
  const visited = [n, 2n, -3n, 4n], accumulated = [5n, 5n + n, 7n + n, 4n + n];
  for (let i = 0; i < visited.length; i++) {
    assert.sameValue(Object.is(seen[i], visited[i]), true);
    assert.sameValue(Object.is(sums[i], accumulated[i]), true);
  }
  const expected = [n, 2n, -3n, 4n];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 32);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [-7n, 0n, 9007199254740993n]) check(n);
