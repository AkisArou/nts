/*---
description: A lying assertion function leaves a string in a claimed numeric Set element through a number-typed call.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberSet(value: unknown): asserts value is Set<number> {}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const set: unknown = new Set<unknown>(["7"]);
assertNumberSet(set);
const [value] = set;
assert.sameValue(describe(value), "string:71");
