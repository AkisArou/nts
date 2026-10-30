/*---
description: A getter shrinks the buffer then throws; the old view index is undefined.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-accessors, ts-numbers, ts-null-undefined, ts-objects, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the throwing getter changes its buffer.
// A getter shrinks the buffer then throws; the old view index is undefined.
function read(size: number): number | undefined {
  const buffer = new ArrayBuffer(4, { maxByteLength: 4 });
  const view = new Uint8Array(buffer);
  view[3] = 44;
  const hook = { get effect(): number { buffer.resize(size); throw new Error("resized"); } };
  const index = 3;
  if (index < view.length) {
    try { hook.effect; } catch {}
    return view[index];
  }
  return -1;
}
for (const size of [0, 1, 3, 4]) assert.sameValue(read(size), size < 4 ? undefined : 44);
