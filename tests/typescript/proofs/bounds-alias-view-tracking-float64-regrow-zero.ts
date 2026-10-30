/*---
description: Alias effects on a Float64Array view: shrink then growth to 64 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-map-set, ts-null-undefined, ts-errors]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the alias route.
// Shrink then growth to 64 bytes restores a valid index with zeroed lost bytes; node reads 0 after the change, otherwise -12.5.
function read(change: number): number {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16);
  const index = 2;
  view[index] = -12.5;
  const buffers = new Map<number, ArrayBuffer>([[1, buffer]]);
  const alias = buffers.get(1);
  if (alias === undefined) throw new Error("missing buffer");
  if (index < view.length) {
    if (change > 0) {
      alias.resize(24);
      alias.resize(64);
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? 0 : -12.5);
}
