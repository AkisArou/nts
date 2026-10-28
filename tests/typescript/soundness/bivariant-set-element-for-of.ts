/*---
description: Set for-of yields a string through a number element type.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's bivariant Set methods permit a wider parameter to add a string.
// Node yields the actual string, whose addition concatenates despite its type.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const seen: string[] = [];
for (const value of set) {
  seen.push(`${typeof value}:${value + 1}`);
}
assert.compareArray(seen, ["number:3", "string:71"]);
