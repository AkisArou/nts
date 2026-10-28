/*---
description: A numeric sort comparator orders injected strings lexically under the relational operators.
features: [ts-unsound-covariant-array, ts-arrays, ts-arrow-functions, ts-expressions, ts-typeof-operator]
---*/
// TypeScript permits writes through unknown[] while the sort parameters
// stay number. Node compares the two actual strings lexically, not numerically.
function append(values: unknown[]): void {
  values.push("2", "10");
}
const values: number[] = [];
append(values);
let comparisons = 0;
values.sort((left: number, right: number) => {
  comparisons++;
  assert.sameValue(typeof left, "string");
  assert.sameValue(typeof right, "string");
  return left < right ? -1 : left > right ? 1 : 0;
});
assert.sameValue(comparisons > 0, true);
assert.sameValue(JSON.stringify(values), '["10","2"]');
