/*---
description: A lying predicate leaves a string in a claimed numeric Map key through a number-typed return.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
function firstKey(map: Map<number, number>): number {
  const [key] = map.keys();
  return key;
}
const map: unknown = new Map<unknown, number>([["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const key: number = firstKey(map);
assert.sameValue(typeof key, "string");
assert.sameValue(String(key + 1), "71");
