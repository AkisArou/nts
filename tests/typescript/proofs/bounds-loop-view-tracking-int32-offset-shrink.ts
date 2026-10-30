/*---
description: Loop effects on an Int32Array view: the offset tracking view loses index 2 when its buffer shrinks to 12 bytes.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the loop route.
// The offset tracking view loses index 2 when its buffer shrinks to 12 bytes; node reads undefined after the change, otherwise -123456789.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 8);
  const index = 2;
  view[index] = -123456789;
  if (index < view.length) {
    let observed: number | undefined = -123456789;
    for (let outer = 0; outer < 2; outer++) {
      for (let inner = 0; inner < change; inner++) {
        observed = view[index];
        if (outer === 0 && inner === 0) { buffer.resize(12); }
      }
    }
    return observed;
  }
  return -999;
}
for (const change of [0, 1, 2, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : -123456789);
}
