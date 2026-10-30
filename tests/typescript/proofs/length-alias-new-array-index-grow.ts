/*---
description: An index store through a local alias grows the original sized allocation.
features: [ts-proof-length, ts-route-alias, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: new Array(n) has length n (docs/foundations/objects.md, Arrays).
// Route: an alias writes at n; node reads n + 1, or n without the store.
function lengthAfterAliasedStore(n: number, append: boolean): number {
  const xs = new Array<number>(n);
  const alias = xs;
  if (append) alias[n] = 99;
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterAliasedStore(n, false), n);
  assert.sameValue(lengthAfterAliasedStore(n, true), n + 1);
}
