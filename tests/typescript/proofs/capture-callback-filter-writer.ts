/*---
description: A filter predicate writes the binding shared with an existing reader.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-arrays]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the predicate updates the outer binding; node reads the last negative item.
function afterFilter(limit: number): number {
  let value = 0;
  const read = (): number => value;
  [1, 2, 3].filter(item => {
    if (item <= limit) value = -item;
    return true;
  });
  return read();
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterFilter(n), n < 1 ? 0 : n < 3 ? -n : -3);
}
