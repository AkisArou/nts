/*---
description: Control for bounds-conversion-to-string-shift; the invalidating route is removed.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-to-string, ts-null-undefined, ts-closures]
---*/
// Paired subject: ../proofs/bounds-conversion-to-string-shift.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const hook = { toString(): string {  return "done"; } };
  const index = 3;
  if (index < xs.length) { String(hook); return xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), 44);
