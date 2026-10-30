/*---
description: An index store on one branch grows an allocation past its initial length.
features: [ts-proof-length, ts-route-merge, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: new Array(n) has length n (docs/foundations/objects.md, Arrays).
// Route: one branch writes at n; node reads n + 1 there and n otherwise.
function lengthAfterBranchStore(n: number, append: boolean): number {
  const xs = new Array<number>(n);
  if (append) xs[n] = 99;
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterBranchStore(n, false), n);
  assert.sameValue(lengthAfterBranchStore(n, true), n + 1);
}
