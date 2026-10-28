/*---
description: Map for-of yields a string key through its nominal number type.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's method bivariance permits widening the map and writing a string
// key. Node yields that string, so adding one concatenates rather than adds.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>([[2, 20]]);
insert(map);
const seen: string[] = [];
for (const entry of map) {
  seen.push(`${typeof entry[0]}:${entry[0] + 1}`);
}
assert.compareArray(seen, ["number:3", "string:71"]);
