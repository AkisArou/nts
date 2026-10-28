/*---
description: A lying assertion function leaves a string in a claimed numeric array element through entries iteration.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = [2, "7"];
assertNumberArray(values);
const seen: string[] = [];
for (const entry of values.entries()) {
  seen.push(entry[0] + ":" + typeof entry[1] + ":" + String(entry[1] + 1));
}
assert.compareArray(seen, ["0:number:3", "1:string:71"]);
