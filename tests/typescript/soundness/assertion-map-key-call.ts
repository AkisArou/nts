/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through a number-typed call.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const map: unknown = new Map<unknown, number>([["7", 70]]);
assertNumberKeys(map);
const [key] = map.keys();
assert.sameValue(describe(key), "string:71");
