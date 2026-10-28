/*---
description: Map entries keeps a string value in a tuple position declared as number.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-tuples, ts-template-literals, ts-typeof-operator]
---*/
// TypeScript's method bivariance lets the wider parameter write a string value.
// Node's entries iterator preserves it in the number-typed tuple position.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>([["control", 2]]);
insert(map);
const seen: string[] = [];
for (const entry of map.entries()) {
  seen.push(`${entry[0]}:${typeof entry[1]}:${entry[1]}`);
}
assert.compareArray(seen, ["control:number:2", "value:string:7"]);
