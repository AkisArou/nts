/*---
description: Merge effects on a Float64Array view: the offset tracking view loses index 2 when its buffer shrinks to 15 bytes.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-expressions]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the merge route.
// The offset tracking view loses index 2 when its buffer shrinks to 15 bytes; node reads undefined after the change, otherwise -12.5.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16);
  const index = 2;
  view[index] = -12.5;
  if (index < view.length) {
    change > 0 && (buffer.resize(15), true);
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : -12.5);
}
