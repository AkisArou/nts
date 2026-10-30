/*---
description: A fixed view reads undefined after shrink; after regrowth its restored tail reads 0.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-tuples]
---*/
// docs/foundations/objects.md, Arrays: index 7 is guarded before the callee shrinks and then regrows a fixed view.
// A fixed view reads undefined after shrink; after regrowth its restored tail reads 0.
function resize(buffer: ArrayBuffer, size: number): void { buffer.resize(size); }
function read(size: number): [number | undefined, number] {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Uint8Array(buffer, 0, 8);
  view[7] = 44;
  const index = 7;
  if (index < view.length) {
    resize(buffer, size);
    const shrunk = view[index];
    resize(buffer, 8);
    return [shrunk, view[index]];
  }
  return [-1, -1];
}
for (const size of [0, 4, 7, 8]) {
  const result = read(size);
  assert.sameValue(result[0], size < 8 ? undefined : 44);
  assert.sameValue(result[1], size < 8 ? 0 : 44);
}
