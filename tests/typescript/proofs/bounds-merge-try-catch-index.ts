/*---
description: Normal and caught paths join with different index ranges.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is initially within the literal length 4.
// Normal and caught paths join with different index ranges.
function read(mode: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let index = 0;
  try {
    if (mode > 0) throw new Error("choose catch");
    index = 1;
  } catch {
    index = 4;
  }
  return xs[index];
}
for (const mode of [-1, 0, 1, 3]) assert.sameValue(read(mode), mode > 0 ? undefined : 22);
