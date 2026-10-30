/*---
description: Accessor effects on an Int32Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-accessors, ts-closures, ts-expressions]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the accessor route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise -123456789.
function read(change: number): { value: number | undefined; signal: number } {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 4, 3);
  const index = 2;
  view[index] = -123456789;
  const gate = {
    get signal(): number { return 0; },
    set signal(next: number) { if (next > 0) { buffer.transfer(32); } }
  };
  if (index < view.length) {
    const signal = gate.signal += change;
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? undefined : -123456789);
  assert.sameValue(result.signal, change);
}
