/*---
description: Numeric conversion can resize the buffer underlying a tracking view.
features: [ts-proof-length, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-numbers]
---*/
// Fact: the tracking view length is 4 (docs/foundations/objects.md, Typed arrays).
// Route: Number runs valueOf and resizes the buffer; node reads n afterwards.
function lengthAfterBufferConversion(n: number): number {
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const view = new Uint16Array(buffer);
  const value = {
    valueOf(): number {
      buffer.resize(n * 2);
      return 0;
    }
  };
  Number(value);
  return view.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterBufferConversion(n), n);
}
