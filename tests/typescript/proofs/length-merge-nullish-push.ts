/*---
description: Only the nullish edge appends before the array's length is read at the join.
features: [ts-proof-length, ts-route-merge, ts-arrays, ts-expressions, ts-functions, ts-iteration, ts-null-undefined, ts-unions]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: ?? may append; node reads 3 for null/undefined and 2 even for zero.
function lengthAfterNullish(value: number | null | undefined): number {
  const xs = [10, 20];
  value ?? xs.push(30);
  return xs.length;
}

for (const value of [0, 1, 3, null, undefined]) {
  const expected = value === null || value === undefined ? 3 : 2;
  assert.sameValue(lengthAfterNullish(value), expected);
}
