/*---
description: A lying predicate leaves a string in a claimed numeric Map value through a spread copy.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-type-guards, ts-narrowing, ts-unknown, ts-arrays]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberValues(value: unknown): value is Map<string, number> {
  return true;
}
const map: unknown = new Map<string, unknown>([["control", 2], ["value", "7"]]);
if (!isNumberValues(map)) throw new Test262Error("predicate rejected the fixture");
const copied = [...map];
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][1], "string");
assert.sameValue(String(copied[1][1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[["control",2],["value","7"]]');
