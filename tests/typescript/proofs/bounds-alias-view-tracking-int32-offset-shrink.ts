/*---
description: Alias effects on an Int32Array view: the offset tracking view loses index 2 when its buffer shrinks to 7 bytes.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the alias route.
// The offset tracking view loses index 2 when its buffer shrinks to 7 bytes; node reads undefined after the change, otherwise -123456789.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 8);
  const index = 2;
  view[index] = -123456789;
  const buffers = [buffer];
  const alias = buffers[0];
  if (index < view.length) {
    if (change > 0) {
      alias.resize(7);
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : -123456789);
}
