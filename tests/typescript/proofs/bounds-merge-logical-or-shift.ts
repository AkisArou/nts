/*---
description: The taken right operand shrinks the array; old last read is undefined.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-expressions, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before either logical-or arm.
// The taken right operand shrinks the array; old last read is undefined.
function read(keep: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const index = 3;
  if (index < xs.length) {
    keep > 0 || xs.shift();
    return xs[index];
  }
  return -1;
}
for (const keep of [-1, 0, 1, 3]) assert.sameValue(read(keep), keep > 0 ? 44 : undefined);
