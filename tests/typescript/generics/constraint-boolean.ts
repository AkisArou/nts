/*---
description: A type parameter constrained to boolean infers a literal and is tested as a condition.
features: [ts-generics, ts-generic-constraints, ts-literal-types]
---*/
function countTrue<T extends boolean>(values: T[]): number {
  let count = 0;
  for (const value of values) if (value) count++;
  return count;
}
function same<T extends boolean>(value: T): T {
  return value;
}
const yes: true = same(true);
assert.sameValue(yes, true);
assert.sameValue(countTrue([true, false, true, true]), 3);
assert.sameValue(countTrue([]), 0);
