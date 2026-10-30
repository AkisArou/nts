/*---
description: A callee transfers the buffer then throws; old view read is undefined.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-numbers, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before a callee may detach its buffer and throw.
// A callee transfers the buffer then throws; old view read is undefined.
function detach(buffer: ArrayBuffer, change: number): void {
  if (change > 0) buffer.transfer();
  throw new Error("after effect");
}
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(4);
  const view = new Int32Array(buffer);
  view[0] = 17;
  const index = 0;
  if (index < view.length) {
    try { detach(buffer, change); } catch {}
    return view[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 17);
