/*---
description: Explicit generic widening leaves a string in a numeric tuple element through a sort comparator.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-expressions, ts-generics, ts-unions, ts-narrowing]
---*/
// TypeScript accepts an explicit unknown instantiation for the numeric slots.
// Its writes violate their number types; node sorts the actual strings lexically.
function write<T>(values: [T, T, boolean], left: T, right: T): void {
  values[0] = left;
  values[1] = right;
}
const values: [number, number, boolean] = [0, 0, true];
write<unknown>(values, "2", "10");
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
