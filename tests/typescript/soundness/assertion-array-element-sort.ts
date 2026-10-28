/*---
description: A lying assertion function leaves a string in a claimed numeric array element through a sort comparator.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-expressions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node sorts the actual strings lexically.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = ["2", "10"];
assertNumberArray(values);
let comparisons = 0;
values.sort((left: number, right: number) => {
  comparisons++;
  assert.sameValue(typeof left, "string");
  assert.sameValue(typeof right, "string");
  return left < right ? -1 : left > right ? 1 : 0;
});
assert.sameValue(comparisons > 0, true);
assert.sameValue(JSON.stringify(values), '["10","2"]');
assert.sameValue(String(values[0] + 1), "101");
