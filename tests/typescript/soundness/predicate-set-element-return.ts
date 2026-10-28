/*---
description: A lying predicate leaves a string in a claimed numeric Set element through a number-typed return.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberSet(value: unknown): value is Set<number> {
  return true;
}
function first(set: Set<number>): number {
  const [value] = set;
  return value;
}
const set: unknown = new Set<unknown>(["7"]);
if (!isNumberSet(set)) throw new Test262Error("predicate rejected the fixture");
const value: number = first(set);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
