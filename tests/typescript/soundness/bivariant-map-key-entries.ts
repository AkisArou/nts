/*---
description: Map entries keeps a widened string key in the number-typed tuple position.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-tuples, ts-template-literals, ts-typeof-operator]
---*/
// TypeScript's method bivariance admits the string write through a wider map.
// Node's entries iterator preserves the key and value in their tuple positions.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>([[2, 20]]);
insert(map);
const seen: string[] = [];
for (const entry of map.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0]}:${entry[1]}`);
}
assert.compareArray(seen, ["number:2:20", "string:7:70"]);
