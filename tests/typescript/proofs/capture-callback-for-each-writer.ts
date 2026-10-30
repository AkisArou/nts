/*---
description: A forEach callback writes the binding held by an earlier reader closure.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-arrays]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: forEach invokes the binding writer; node reads the last eligible item.
function afterForEach(limit: number): number {
  let value = 0;
  const read = (): number => value;
  [1, 2, 3].forEach(item => { if (item <= limit) value = item; });
  return read();
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterForEach(n), n < 1 ? 0 : n < 3 ? n : 3);
}
