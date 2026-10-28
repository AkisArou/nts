/*---
description: A lying predicate leaves a string in a claimed numeric array element through entries iteration.
features: [ts-unsound-predicate, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberArray(value: unknown): value is number[] {
  return true;
}
const values: unknown = [2, "7"];
if (!isNumberArray(values)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
for (const entry of values.entries()) {
  seen.push(entry[0] + ":" + typeof entry[1] + ":" + String(entry[1] + 1));
}
assert.compareArray(seen, ["0:number:3", "1:string:71"]);
