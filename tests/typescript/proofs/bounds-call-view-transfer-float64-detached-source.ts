/*---
description: Call effects on a Float64Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the call route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise -12.5.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 8, 3);
  const index = 2;
  view[index] = -12.5;
  function update(): void {
    if (change > 0) {
      buffer.transferToFixedLength(40);
    }
  }
  function first(depth: number): void { if (depth > 0) second(depth - 1); else update(); }
  function second(depth: number): void { if (depth > 0) first(depth - 1); else update(); }
  if (index < view.length) {
    first(3);
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : -12.5);
}
