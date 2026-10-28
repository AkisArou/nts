/*---
description: Map values preserves a string despite the iterator's number element type.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's method bivariance accepts the wider map, which can store a
// string. Node's values iterator yields it, so plus keeps string concatenation.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>([["control", 2]]);
insert(map);
const seen: string[] = [];
for (const value of map.values()) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
