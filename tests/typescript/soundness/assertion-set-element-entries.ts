/*---
description: A lying assertion function leaves a string in a claimed numeric Set element through entries iteration.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-assertion-functions, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberSet(value: unknown): asserts value is Set<number> {}
const set: unknown = new Set<unknown>([2, "7"]);
assertNumberSet(set);
const seen: string[] = [];
for (const entry of set.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0] + 1}/${typeof entry[1]}:${entry[1] + 1}`);
}
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
