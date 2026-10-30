/*---
description: A detached-view write is ignored; the transferred buffer keeps its original element.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// docs/foundations/objects.md, Arrays: index 0 is guarded before the callee transfers its buffer.
// A detached-view write is ignored; the transferred buffer keeps its original element.
function move(buffer: ArrayBuffer): ArrayBuffer { return buffer.transfer(); }
function write(value: number, detach: boolean): number {
  const buffer = new ArrayBuffer(4);
  const view = new Int32Array(buffer);
  view[0] = 17;
  const index = 0;
  if (index < view.length) {
    const moved = detach ? move(buffer) : buffer;
    view[index] = value;
    return new Int32Array(moved)[0];
  }
  return -1;
}
for (const value of [0, 1, 44, -3]) for (const detach of [false, true]) {
  assert.sameValue(write(value, detach), detach ? 17 : value);
}
