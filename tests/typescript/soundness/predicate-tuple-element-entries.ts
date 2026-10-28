/*---
description: A lying predicate leaves a string in a claimed numeric tuple element through entries iteration.
features: [ts-unsound-predicate, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-type-guards, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberTuple(value: unknown): value is [number, boolean] {
  return true;
}
const values: unknown = ["7", true];
if (!isNumberTuple(values)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
for (const entry of values.entries()) {
  const value = entry[1];
  const text = typeof value === "boolean" ? "boolean:" + String(value) : typeof value + ":" + String(value + 1);
  seen.push(entry[0] + ":" + text);
}
assert.compareArray(seen, ["0:string:71", "1:boolean:true"]);
