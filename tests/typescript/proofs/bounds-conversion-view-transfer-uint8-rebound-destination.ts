/*---
description: Conversion effects on a Uint8Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-class, ts-closures, ts-conversions, ts-to-primitive, ts-objects, ts-strings, ts-to-string, ts-computed-keys]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the conversion route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads 173 + (3 + change) after the change, otherwise 173.
function read(change: number): { value: number; signal: boolean } {
  const buffer = new ArrayBuffer(6);
  let view = new Uint8Array(buffer, 1, 3);
  const index = 2;
  view[index] = 173;
  class Trigger {
    toString(): string {
      if (change > 0) {
        const moved = buffer.transfer(5);
        view = new Uint8Array(moved, 1, 3);
        view[index] += 3 + change;
      }
      return "sample";
    }
  }
  const trigger = new Trigger();
  if (index < view.length) {
    const record = { [String(trigger)]: view[index] };
    const signal = "sample" in record;
    return { value: record.sample, signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? 173 + (3 + change) : 173);
  assert.sameValue(result.signal, true);
}
