/*---
description: Array.from passes an injected string to the mapper under the Map value's number type.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions]
---*/
// TypeScript's method bivariance accepts the wider Map writer despite the
// retained number value type. Node keeps the inserted string through this read.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>([["control", 2]]);
insert(map);
const seen = Array.from(map, (entry) => typeof entry[1] + ":" + String(entry[1] + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
