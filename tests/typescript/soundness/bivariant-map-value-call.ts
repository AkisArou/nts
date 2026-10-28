/*---
description: A string value read through a number-valued Map reaches a number parameter unchanged.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions]
---*/
// TypeScript's method bivariance accepts the wider Map writer despite the
// retained number value type. Node keeps the inserted string through this read.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const map = new Map<string, number>();
insert(map);
const value = map.get("value");
if (value === undefined) throw new Test262Error("stored value is missing");
assert.sameValue(describe(value), "string:71");
