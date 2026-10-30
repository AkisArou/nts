/*---
description: Only the nullish arm removes the guarded slot; read is undefined.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-expressions, ts-null-undefined, ts-unions]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the nullish merge.
// Only the nullish arm removes the guarded slot; read is undefined.
function read(value: number | null | undefined): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    value ?? xs.splice(3, 1);
    return xs[index];
  }
  return -1;
}
for (const value of [undefined, null, 0, 1, 3]) {
  assert.sameValue(read(value), value == null ? undefined : 44);
}
