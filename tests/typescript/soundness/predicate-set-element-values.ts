/*---
description: A lying predicate leaves a string in a claimed numeric Set element through values iteration.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-type-guards, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberSet(value: unknown): value is Set<number> {
  return true;
}
const set: unknown = new Set<unknown>([2, "7"]);
if (!isNumberSet(set)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
for (const value of set.values()) {
  seen.push(`${typeof value}:${value}`);
}
assert.compareArray(seen, ["number:2", "string:7"]);
