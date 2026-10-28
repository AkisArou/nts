/*---
description: A lying assertion function leaves a string in a claimed numeric array element through values iteration.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = [2, "7"];
assertNumberArray(values);
const seen: string[] = [];
for (const value of values.values()) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
