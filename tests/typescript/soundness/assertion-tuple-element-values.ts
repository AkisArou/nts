/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through values iteration.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
const seen: string[] = [];
for (const value of values.values()) {
  if (typeof value === "boolean") seen.push("boolean:" + String(value));
  else seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["string:71", "boolean:true"]);
