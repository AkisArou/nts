/*---
description: An escaped closure shortens the literal array before the read.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-function-types, ts-null-undefined, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before invoking a returned closure.
// An escaped closure shortens the literal array before the read.
function mutator(xs: number[], n: number): () => void {
  return () => { if (n > 0) xs.splice(3, 1); };
}
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const changeArray = mutator(xs, change);
  const index = 3;
  if (index < xs.length) { changeArray(); return xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
