/*---
description: Conversion effects on a Float64Array view: shrinking to 39 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-class, ts-closures, ts-conversions, ts-to-primitive]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the conversion route.
// Shrinking to 39 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise -12.5.
function read(change: number): { value: number | undefined; signal: number } {
  const buffer = new ArrayBuffer(64, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16, 3);
  const index = 1;
  view[index] = -12.5;
  class Trigger {
    valueOf(): number { if (change > 0) { buffer.resize(39); } return change + 5; }
  }
  const trigger = new Trigger();
  if (index < view.length) {
    const signal = Number(trigger);
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? undefined : -12.5);
  assert.sameValue(result.signal, change + 5);
}
