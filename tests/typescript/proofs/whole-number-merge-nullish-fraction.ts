/*---
description: A nullish fallback can replace a whole numeric binding with a fraction.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-expressions, ts-unions, ts-null-undefined]
---*/
// Fact: the initial seven is a whole int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the nullish edge supplies 3.5; node keeps zero on the non-nullish edge.
function afterNullish(input: number | null | undefined): number {
  let value = 7;
  value = input ?? 3.5;
  return value;
}

for (const n of [0, 1, 3, 7]) {
  assert.sameValue(afterNullish(n), n);
}
for (const n of [null, undefined]) {
  assert.sameValue(afterNullish(n), 3.5);
}
