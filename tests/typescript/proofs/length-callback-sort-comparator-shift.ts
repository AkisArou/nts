/*---
description: A comparator on a separate array shortens a captured allocation exactly once.
features: [ts-proof-length, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: a comparator shifts once regardless of call count; node reads 3.
function lengthAfterComparator(n: number): number {
  const xs = [10, 20, 30, 40];
  const order = [3, 1, 2];
  let shifted = false;
  order.sort((a, b) => {
    if (n > 0 && !shifted) {
      xs.shift();
      shifted = true;
    }
    return a - b;
  });
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterComparator(n), n > 0 ? 3 : 4);
}
