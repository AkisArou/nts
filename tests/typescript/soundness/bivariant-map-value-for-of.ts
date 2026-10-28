/*---
description: Map for-of yields a string through its nominal number value type.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's bivariant map methods permit this wider parameter to store a
// string value. Node yields the string through the narrow map's iterator.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>([["control", 2]]);
insert(map);
const seen: string[] = [];
for (const entry of map) {
  seen.push(`${typeof entry[1]}:${entry[1] + 1}`);
}
assert.compareArray(seen, ["number:3", "string:71"]);
