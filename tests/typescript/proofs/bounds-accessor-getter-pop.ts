/*---
description: Reading a getter removes the guarded slot; read is undefined.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-null-undefined, ts-closures]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before the getter removes it.
// Reading a getter removes the guarded slot; read is undefined.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const hook = { get effect(): number { if (change > 0) xs.pop(); return 0; } };
  const index = 3;
  if (index < xs.length) { hook.effect; return xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
