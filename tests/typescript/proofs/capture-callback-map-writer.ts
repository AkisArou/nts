/*---
description: A mapper writes the binding observed by a closure created before map.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-arrays]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: map invokes a writer of the shared local; node reads its latest multiple of ten.
function afterMap(limit: number): number {
  let value = 0;
  const read = (): number => value;
  [1, 2, 3].map(item => {
    if (item <= limit) value = item * 10;
    return item + 1;
  });
  return read();
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterMap(n), n < 1 ? 0 : n < 3 ? n * 10 : 30);
}
