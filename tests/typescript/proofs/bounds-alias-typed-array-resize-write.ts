/*---
description: An out-of-range tracking-view write is ignored; regrown bytes remain zero.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before resizing through the buffer alias.
// An out-of-range tracking-view write is ignored; regrown bytes remain zero.
function write(size: number): number {
  const buffer = new ArrayBuffer(4, { maxByteLength: 4 });
  const alias = buffer;
  const view = new Uint8Array(buffer);
  view[3] = 44;
  const index = 3;
  if (index < view.length) {
    alias.resize(size);
    view[index] = 99;
    alias.resize(4);
    return view[index];
  }
  return -1;
}
for (const size of [0, 1, 3, 4]) assert.sameValue(write(size), size < 4 ? 0 : 99);
