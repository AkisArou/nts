/*---
description: Entries through an interface-held Uint32Array preserve unsigned values above the signed 32-bit boundary.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-tuples, ts-interfaces]
---*/
// Read entries through an interface field; node returns relative indices and full uint32 payloads in order.
interface MethodViewHolder { view: Uint32Array; }
function check(holder: MethodViewHolder, n: number): void {
  const view = holder.view;
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
for (const n of [0, 1, 4294967295]) check({ view: new Uint32Array(new ArrayBuffer(20), 4, 3) }, n);
