/*---
description: An owner alias can invalidate the positive-zero fact of a numeric field.
features: [ts-proof-negative-zero, ts-route-alias, ts-functions, ts-iteration, ts-numbers, ts-objects]
---*/
// Fact: the field begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the second owner name stores -0; node reads that sign through the original owner.
function throughAlias(n: number): number {
  const owner = { value: 0 };
  const alias = owner;
  if (n > 0) alias.value = -0;
  return owner.value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(throughAlias(n), n > 0 ? -0 : 0);
}
