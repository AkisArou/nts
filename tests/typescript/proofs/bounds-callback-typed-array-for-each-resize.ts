/*---
description: A typed-array callback shrinks the target view's buffer.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before a typed-array callback shrinks its buffer.
// A typed-array callback shrinks the target view's buffer.
function read(size: number): number | undefined {
  const buffer = new ArrayBuffer(4, { maxByteLength: 4 });
  const view = new Uint8Array(buffer);
  view[3] = 44;
  const index = 3;
  if (index < view.length) {
    new Uint8Array([0, 1]).forEach((step) => { if (step === 0) buffer.resize(size); });
    return view[index];
  }
  return -1;
}
for (const size of [0, 1, 3, 4]) assert.sameValue(read(size), size < 4 ? undefined : 44);
