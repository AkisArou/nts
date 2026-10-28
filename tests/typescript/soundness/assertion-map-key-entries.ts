/*---
description: A lying assertion function leaves a string in a claimed numeric Map key through entries iteration.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-assertion-functions, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberKeys(value: unknown): asserts value is Map<number, number> {}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
assertNumberKeys(map);
const seen: string[] = [];
for (const entry of map.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0]}:${entry[1]}`);
}
assert.compareArray(seen, ["number:2:20", "string:7:70"]);
