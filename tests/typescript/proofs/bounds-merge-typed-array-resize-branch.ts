/*---
description: The shorter-buffer arm invalidates a formerly valid view index.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: tracking view index 3 is guarded at length 4.
// The shorter-buffer arm invalidates a formerly valid view index.
function read(size: number): number | undefined {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new Uint8Array(buffer);
  view[3] = 44;
  const index = 3;
  if (index < view.length) {
    if (size < 4) buffer.resize(size);
    else buffer.resize(8);
    return view[index];
  }
  return -1;
}
for (const size of [0, 2, 3, 4, 8]) assert.sameValue(read(size), size < 4 ? undefined : 44);
