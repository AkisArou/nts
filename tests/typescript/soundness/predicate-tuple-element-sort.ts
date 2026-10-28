/*---
description: A lying predicate leaves a string in a claimed numeric tuple element through a sort comparator.
features: [ts-unsound-predicate, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-expressions, ts-type-guards, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node sorts the actual strings lexically.
function isNumberTuple(value: unknown): value is [number, number, boolean] {
  return true;
}
const values: unknown = ["2", "10", true];
if (!isNumberTuple(values)) throw new Test262Error("predicate rejected the fixture");
let comparisons = 0;
values.sort((left: number | boolean, right: number | boolean) => {
  if (typeof left === "boolean") return typeof right === "boolean" ? 0 : 1;
  if (typeof right === "boolean") return -1;
  comparisons++;
  assert.sameValue(typeof left, "string");
  assert.sameValue(typeof right, "string");
  return left < right ? -1 : left > right ? 1 : 0;
});
assert.sameValue(comparisons > 0, true);
assert.sameValue(JSON.stringify(values), '["10","2",true]');
assert.sameValue(String(values[0] + 1), "101");
