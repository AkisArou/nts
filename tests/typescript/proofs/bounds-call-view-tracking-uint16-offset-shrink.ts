/*---
description: Call effects on a Uint16Array view: the offset tracking view loses index 2 when its buffer shrinks to 6 bytes.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the call route.
// The offset tracking view loses index 2 when its buffer shrinks to 6 bytes; node reads undefined after the change, otherwise 50003.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 4);
  const index = 2;
  view[index] = 50003;
  function descend(depth: number): void {
    if (depth > 0) { descend(depth - 1); return; }
    if (change > 0) { buffer.resize(6); }
  }
  if (index < view.length) {
    descend(3);
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : 50003);
}
