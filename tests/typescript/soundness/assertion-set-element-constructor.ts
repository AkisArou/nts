/*---
description: A lying assertion function leaves a string in a claimed numeric Set element through a copy constructor.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberSet(value: unknown): asserts value is Set<number> {}
const set: unknown = new Set<unknown>([2, "7"]);
assertNumberSet(set);
const copy = new Set(set);
const seen: string[] = [];
for (const value of copy) {
  seen.push(`${typeof value}:${value + 1}`);
  assert.sameValue(copy.has(value), true);
}
assert.sameValue(copy.has(7), false);
assert.compareArray(seen, ["number:3", "string:71"]);
