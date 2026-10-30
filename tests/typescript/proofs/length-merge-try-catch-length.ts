/*---
description: Normal and caught paths join with different lengths of one allocation.
features: [ts-proof-length, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-errors]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: normal and caught updates join; node reads 5, 4, or 1.
function lengthAfterCatchJoin(n: number): number {
  const xs = [10, 20, 30, 40];
  try {
    if (n > 0) {
      xs.pop();
      throw new Error('shorten');
    }
    if (n < 0) xs.push(50);
  } catch {
    xs.splice(1);
  }
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterCatchJoin(n), n < 0 ? 5 : n === 0 ? 4 : 1);
}
