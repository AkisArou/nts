/*---
description: The path surviving an early return reads the array after growth.
features: [ts-proof-length, ts-route-merge, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: the literal has length 3 (docs/foundations/objects.md, Arrays).
// Route: the surviving path appends; node reads 4 there and 3 on early return.
function lengthPastReturn(n: number): number {
  const xs = [10, 20, 30];
  if (n <= 0) return xs.length;
  xs.push(n);
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthPastReturn(n), n > 0 ? 4 : 3);
}
