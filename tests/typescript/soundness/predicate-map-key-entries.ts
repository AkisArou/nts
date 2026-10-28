/*---
description: A lying predicate leaves a string in a claimed numeric Map key through entries iteration.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-type-guards, ts-narrowing, ts-unknown, ts-template-literals]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberKeys(value: unknown): value is Map<number, number> {
  return true;
}
const map: unknown = new Map<unknown, number>([[2, 20], ["7", 70]]);
if (!isNumberKeys(map)) throw new Test262Error("predicate rejected the fixture");
const seen: string[] = [];
for (const entry of map.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0]}:${entry[1]}`);
}
assert.compareArray(seen, ["number:2:20", "string:7:70"]);
