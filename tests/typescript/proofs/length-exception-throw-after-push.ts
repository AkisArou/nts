/*---
description: A caught throw skips rollback after an array append.
features: [ts-proof-length, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: throwing skips the compensating pop; node reads 3 instead of 2.
function lengthAfterInterruptedUpdate(n: number): number {
  const xs = [10, 20];
  try {
    xs.push(n);
    if (n > 0) throw new Error('keep append');
    xs.pop();
  } catch {
  }
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterInterruptedUpdate(n), n > 0 ? 3 : 2);
}
