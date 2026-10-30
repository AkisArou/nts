/*---
description: A find predicate writes the captured binding before short-circuiting.
features: [ts-proof-capture, ts-route-callback, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-arrays]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the successful predicate writes before find returns; node observes that latest binding.
function afterFind(wanted: number): number {
  let value = 0;
  const read = (): number => value;
  [1, 2, 3].find(item => {
    if (item !== wanted) return false;
    value = item + 20;
    return true;
  });
  return read();
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterFind(n), n >= 1 && n <= 3 ? n + 20 : 0);
}
