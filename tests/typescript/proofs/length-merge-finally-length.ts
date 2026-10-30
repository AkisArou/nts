/*---
description: Finally carries changed lengths from normal and caught paths to one read.
features: [ts-proof-length, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-errors]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: finally pops after either path; node reads 3, 4, or 5 at the join.
function lengthAfterFinallyJoin(n: number): number {
  const xs = [10, 20, 30, 40];
  try {
    if (n > 0) {
      xs.push(n, n);
      throw new Error('join');
    }
  } catch {
  } finally {
    if (n !== 0) xs.pop();
  }
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterFinallyJoin(n), n < 0 ? 3 : n === 0 ? 4 : 5);
}
