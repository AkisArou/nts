/*---
description: A sort comparator can update a previously read-only captured binding.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-arrays]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: each comparator write stores the same n; node sees it regardless of comparison order.
function afterSort(n: number): number {
  let value = 0;
  const read = (): number => value;
  [3, 1, 2].sort((a, b) => {
    if (n > 0) value = n;
    return a - b;
  });
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterSort(n), n > 0 ? n : 0);
