/*---
description: A find predicate can empty the allocation whose length is read afterward.
features: [ts-proof-length, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: the matching predicate empties it; node reads 0, or unchanged 4.
function lengthAfterFind(n: number): number {
  const xs = [10, 20, 30, 40];
  [0, 1, 2].find(step => {
    if (step === n) {
      xs.length = 0;
      return true;
    }
    return false;
  });
  return xs.length;
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(lengthAfterFind(n), n >= 0 && n < 3 ? 0 : 4);
}
