/*---
description: Number conversion falls back to toString, which deletes the already guarded suffix.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-conversions, ts-to-primitive, ts-objects, ts-null-undefined, ts-closures, ts-to-string]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded before numeric primitive-conversion fallback.
// Number conversion falls back to toString, which deletes the already guarded suffix.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const hook = {
    valueOf(): object { return {}; },
    toString(): string { if (change > 0) xs.splice(3, 1); return "0"; }
  };
  const index = 3;
  if (index < xs.length) { Number(hook); return xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
