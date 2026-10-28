/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through keys iteration.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
assertNumberKeys(map);
const seen: string[] = [];
for (const key of map.keys()) {
  seen.push(typeof key + ":" + String(key + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
