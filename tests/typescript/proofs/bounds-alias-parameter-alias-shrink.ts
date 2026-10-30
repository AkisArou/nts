/*---
description: Two parameters denote one array; writing through one invalidates the other.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: the guard on one parameter precedes a write through its alias parameter.
// Two parameters denote one array; writing through one invalidates the other.
function read(xs: number[], alias: number[], change: number): number | undefined {
  const index = 3;
  if (index < xs.length) {
    if (change > 0) alias.length = 3;
    return xs[index];
  }
  return -1;
}
for (const change of [-1, 0, 1, 4]) for (const shared of [false, true]) {
  const xs = [11, 22, 33, 44];
  const other = [55, 66, 77, 88];
  assert.sameValue(read(xs, shared ? xs : other, change), shared && change > 0 ? undefined : 44);
}
