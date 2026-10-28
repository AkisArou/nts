/*---
description: A covariant write preserves the string through a sort comparator of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-expressions, ts-unions, ts-narrowing]
---*/
// TypeScript permits a covariantly widened tuple to receive strings in
// numeric slots. Node compares the real strings lexically in the comparator.
const values: [number, number, boolean] = [0, 0, true];
const wider: [unknown, unknown, boolean] = values;
wider[0] = "2";
wider[1] = "10";
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
