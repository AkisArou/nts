/*---
description: Spreading a number-valued Map copies the string value written through a wider parameter.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-arrays]
---*/
// TypeScript's method bivariance accepts the wider Map writer despite the
// retained number value type. Node keeps the inserted string through this read.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>([["control", 2]]);
insert(map);
const copied = [...map];
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][1], "string");
assert.sameValue(String(copied[1][1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[["control",2],["value","7"]]');
