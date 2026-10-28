/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through entries iteration.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
const seen: string[] = [];
for (const entry of values.entries()) {
  const value = entry[1];
  const text = typeof value === "boolean" ? "boolean:" + String(value) : typeof value + ":" + String(value + 1);
  seen.push(entry[0] + ":" + text);
}
assert.compareArray(seen, ["0:string:71", "1:boolean:true"]);
