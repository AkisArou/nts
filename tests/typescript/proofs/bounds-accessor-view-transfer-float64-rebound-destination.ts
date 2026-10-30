/*---
description: Accessor effects on a Float64Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-accessors, ts-closures, ts-spread]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the accessor route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads -12.5 + (0.5 + change) after the change, otherwise -12.5.
function read(change: number): { value: number; signal: number } {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  let view = new Float64Array(buffer, 8, 3);
  const index = 2;
  view[index] = -12.5;
  const gate = {
    get signal(): number {
      if (change > 0) {
        const moved = buffer.transferToFixedLength(64);
        view = new Float64Array(moved, 8, 3);
        view[index] += 0.5 + change;
      }
      return change + 5;
    }
  };
  if (index < view.length) {
    const copied = { ...gate };
    const signal = copied.signal;
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? -12.5 + (0.5 + change) : -12.5);
  assert.sameValue(result.signal, change + 5);
}
