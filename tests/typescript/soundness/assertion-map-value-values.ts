/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through values iteration.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
assertNumberValues(map);
const seen: string[] = [];
for (const value of map.values()) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
