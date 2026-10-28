/*---
description: A lying predicate leaves a string in a claimed numeric Map key through a number-typed call.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const map: unknown = new Map<unknown, number>([["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const [key] = map.keys();
assert.sameValue(describe(key), "string:71");
