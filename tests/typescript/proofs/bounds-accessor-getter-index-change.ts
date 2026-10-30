/*---
description: A getter changes the formerly safe index from 0 to 4.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-closures, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is initially inside the literal array.
// A getter changes the formerly safe index from 0 to 4.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let index = 0;
  const hook = { get effect(): number { if (change > 0) index = 4; return 0; } };
  hook.effect;
  return xs[index];
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 11);
