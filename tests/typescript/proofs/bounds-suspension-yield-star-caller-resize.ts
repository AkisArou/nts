/*---
description: A delegated yield permits a buffer shrink before the guarded view read.
features: [ts-proof-bounds, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-generators, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the delegated yield permits a resize.
// A delegated yield permits a buffer shrink before the guarded view read.
function* pause(): Generator<number, void, void> { yield 1; }
function* read(view: Uint8Array): Generator<number, number | undefined, void> {
  const index = 3;
  if (index < view.length) { yield* pause(); return view[index]; }
  return -1;
}
for (const size of [0, 1, 3, 4]) {
  const buffer = new ArrayBuffer(4, { maxByteLength: 4 });
  const view = new Uint8Array(buffer);
  view[3] = 44;
  const iterator = read(view);
  assert.sameValue(iterator.next().value, 1);
  buffer.resize(size);
  const result = iterator.next();
  assert.sameValue(result.done, true);
  assert.sameValue(result.value, size < 4 ? undefined : 44);
}
