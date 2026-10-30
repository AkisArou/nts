/*---
description: A reducer writes the captured binding before its sibling reader is called.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-arrays]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: reduce writes a prefix sum into the shared binding; node sees 0, 1, 3, or 6.
function afterReduce(limit: number): number {
  let value = 0;
  const read = (): number => value;
  [1, 2, 3].reduce((sum, item) => {
    if (item <= limit) value = sum + item;
    return sum + item;
  }, 0);
  return read();
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterReduce(n), n < 1 ? 0 : n === 1 ? 1 : n === 2 ? 3 : 6);
}
