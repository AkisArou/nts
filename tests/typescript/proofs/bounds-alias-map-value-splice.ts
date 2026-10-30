/*---
description: A splice through an array recovered from a Map invalidates the original array's bound.
features: [ts-proof-bounds, ts-route-alias, ts-arrays, ts-map-set, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded by this array's length.
// The Map value is the same array; splicing that alias makes node read undefined.
function readAfterMapAlias(cut: number): number | undefined {
  const xs = [10, 20, 30, 40];
  const aliases = new Map<string, number[]>([["shared", xs]]);
  const alias = aliases.get("shared");
  if (alias === undefined) return -1;
  const i = 3;
  if (i < xs.length) {
    alias.splice(cut);
    return xs[i];
  }
  return -1;
}

for (const cut of [0, 1, 3, 4, 7]) {
  assert.sameValue(readAfterMapAlias(cut), cut < 4 ? undefined : 40);
}
