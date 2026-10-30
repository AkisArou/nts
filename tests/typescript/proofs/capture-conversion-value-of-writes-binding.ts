/*---
description: Numeric conversion calls a writer of the binding held by an earlier reader.
features: [ts-proof-capture, ts-route-conversion, ts-functions, ts-iteration, ts-closures, ts-conversions, ts-to-primitive, ts-objects]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: Number runs valueOf between capture and read; node returns the latest shared value.
function afterConversion(n: number): number {
  let value = 0;
  const read = (): number => value;
  const hook = { valueOf(): number { value = n; return 0; } };
  const ignored = Number(hook);
  return read() + ignored;
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterConversion(n), n);
