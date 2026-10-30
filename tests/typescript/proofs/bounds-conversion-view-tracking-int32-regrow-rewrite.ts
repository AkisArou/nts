/*---
description: Conversion effects on an Int32Array view: shrink then growth to 32 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-class, ts-closures, ts-conversions, ts-to-primitive, ts-strings, ts-to-string, ts-template-literals]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the conversion route.
// Shrink then growth to 32 bytes restores a valid index with zeroed lost bytes; node reads -300 - change after the change, otherwise -123456789.
function read(change: number): { value: number; signal: string } {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 8);
  const index = 2;
  view[index] = -123456789;
  class Trigger {
    toString(): string {
      if (change > 0) {
        buffer.resize(12);
        buffer.resize(32);
        view[index] += -300 - change;
      }
      return "changed";
    }
  }
  const trigger = new Trigger();
  if (index < view.length) {
    const signal = `${trigger}`;
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? -300 - change : -123456789);
  assert.sameValue(result.signal, "changed");
}
