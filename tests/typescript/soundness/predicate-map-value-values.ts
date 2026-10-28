/*---
description: A lying predicate leaves a string in a claimed numeric Map value through values iteration.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberValues(value: unknown): value is Map<string, number> {
  return true;
}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
if (!isNumberValues(map)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
for (const value of map.values()) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
