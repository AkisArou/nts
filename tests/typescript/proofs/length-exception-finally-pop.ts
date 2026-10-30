/*---
description: A pop during exception unwinding changes the length read after the catch.
features: [ts-proof-length, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: finally pops during unwinding; node reads 3, or unchanged 4.
function lengthAfterUnwind(n: number): number {
  const xs = [10, 20, 30, 40];
  try {
    try {
      if (n > 0) throw new Error('unwind');
    } finally {
      if (n > 0) xs.pop();
    }
  } catch {
  }
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterUnwind(n), n > 0 ? 3 : 4);
}
