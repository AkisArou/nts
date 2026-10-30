/*---
description: Accessor effects on a Uint16Array view: shrink then growth to 16 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-accessors, ts-closures, ts-class]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the accessor route.
// Shrink then growth to 16 bytes restores a valid index with zeroed lost bytes; node reads 0 after the change, otherwise 50003.
function read(change: number): { value: number; signal: number } {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 4);
  const index = 2;
  view[index] = 50003;
  class Gate {
    get signal(): number {
      if (change > 0) {
        buffer.resize(6);
        buffer.resize(16);
      }
      return change + 5;
    }
  }
  const gate = new Gate();
  if (index < view.length) {
    const signal = gate.signal;
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? 0 : 50003);
  assert.sameValue(result.signal, change + 5);
}
