/*---
description: A field update through an owner alias invalidates its integer-only fact.
features: [ts-proof-whole-number, ts-route-alias, ts-functions, ts-iteration, ts-numbers, ts-objects]
---*/
// Fact: the numeric field is initialized to whole seven (docs/foundations/numbers.md, Integers proved from doubles).
// Route: another owner name divides the same field; node reads 3.5 through the original.
function throughAlias(n: number): number {
  const owner = { value: 7 };
  const alias = owner;
  if (n > 0) alias.value /= 2;
  return owner.value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(throughAlias(n), n > 0 ? 3.5 : 7);
}
