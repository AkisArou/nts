/*---
description: String(value) runs toString, which removes the guarded slot.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-to-string, ts-null-undefined, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before String calls toString.
// String(value) runs toString, which removes the guarded slot.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const hook = { toString(): string { if (change > 0) xs.shift(); return "done"; } };
  const index = 3;
  if (index < xs.length) { String(hook); return xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
