/*---
description: Conversion effects on a Uint16Array view: the offset tracking view loses index 2 when its buffer shrinks to 3 bytes.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-class, ts-closures, ts-conversions, ts-to-primitive]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the conversion route.
// The offset tracking view loses index 2 when its buffer shrinks to 3 bytes; node reads undefined after the change, otherwise 50003.
function read(change: number): { value: number | undefined; signal: number } {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 4);
  const index = 2;
  view[index] = 50003;
  class Trigger {
    valueOf(): number { if (change > 0) { buffer.resize(3); } return change + 5; }
  }
  const trigger = new Trigger();
  if (index < view.length) {
    const signal = +trigger;
    return { value: view[index], signal };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? undefined : 50003);
  assert.sameValue(result.signal, change + 5);
}
