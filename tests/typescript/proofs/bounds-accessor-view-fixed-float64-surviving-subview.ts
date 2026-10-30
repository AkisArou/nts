/*---
description: Accessor effects on a Float64Array view: the original fixed subview survives a shrink to 24 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-accessors, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the accessor route.
// The original fixed subview survives a shrink to 24 bytes and reads a fresh sibling write; node reads -2.25 - change after the change, otherwise -12.5.
function read(change: number): { value: number; signal: number; bytes: number } {
  const buffer = new ArrayBuffer(64, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 8, 2);
  const index = 1;
  view[index] = -12.5;
  const gate = {
    set signal(next: number) {
      if (next > 0) {
        buffer.resize(24);
        const sibling = new Float64Array(buffer, 8, 2);
        sibling[index] = -2.25 - change;
      }
    }
  };
  if (index < view.length) {
    const signal = gate.signal = change;
    return { value: view[index], signal, bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? -2.25 - change : -12.5);
  assert.sameValue(result.signal, change);
  assert.sameValue(result.bytes, change > 0 ? 24 : 64);
}
