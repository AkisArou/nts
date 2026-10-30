/*---
description: Conversion effects on a Float64Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-class, ts-closures, ts-conversions, ts-to-primitive, ts-class-fields, ts-this, ts-expressions]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the conversion route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise -12.5.
function read(change: number): { value: number | undefined; signal: boolean } {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 8, 3);
  const index = 2;
  view[index] = -12.5;
  class Trigger {
    active: boolean;
    constructor(active: boolean) { this.active = active; }
    valueOf(): number {
      if (this.active && change > 0) { buffer.transferToFixedLength(40); }
      return this.active ? change : 2;
    }
  }
  const left = new Trigger(true);
  const right = new Trigger(false);
  if (index < view.length) {
    const signal = left < right;
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? undefined : -12.5);
  assert.sameValue(result.signal, change < 2);
}
