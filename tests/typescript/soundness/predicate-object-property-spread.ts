/*---
description: A lying predicate leaves a string in a claimed numeric object property through a spread copy.
features: [ts-unsound-predicate, ts-objects, ts-typeof-operator, ts-conversions, ts-spread, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberState(value: unknown): value is { value: number } {
  return true;
}
const cell: unknown = { value: "7" };
if (!isNumberState(cell)) throw new Test262Error("predicate rejected the fixture");
const copied = { ...cell };
assert.sameValue(typeof copied.value, "string");
assert.sameValue(String(copied.value + 1), "71");
assert.sameValue(JSON.stringify(copied), '{"value":"7"}');
