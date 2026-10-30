/*---
description: Accessor effects on an Int32Array view: shrinking to 19 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-accessors, ts-closures, ts-class]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the accessor route.
// Shrinking to 19 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise -123456789.
function read(change: number): { value: number | undefined; signal: number } {
  const buffer = new ArrayBuffer(32, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 8, 3);
  const index = 1;
  view[index] = -123456789;
  class Gate {
    get signal(): number { if (change > 0) { buffer.resize(19); } return change + 5; }
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
  assert.sameValue(result.value, change > 0 ? undefined : -123456789);
  assert.sameValue(result.signal, change + 5);
}
