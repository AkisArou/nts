/*---
description: Map.forEach can write the captured binding later returned by its sibling reader.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-map-set]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: Map.forEach writes the shared binding; node sees the last eligible Map value.
function afterForEach(limit: number): number {
  let value = 0;
  const read = (): number => value;
  const entries = new Map<number, number>([[1, 10], [2, 20], [3, 30]]);
  entries.forEach((entry, key) => { if (key <= limit) value = entry; });
  return read();
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterForEach(n), n < 1 ? 0 : n < 3 ? n * 10 : 30);
}
