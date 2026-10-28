/*---
description: A function returning a number preserves a string read from a number-valued Map.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions]
---*/
// TypeScript's method bivariance accepts the wider Map writer despite the
// retained number value type. Node keeps the inserted string through this read.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
function read(map: Map<string, number>): number {
  const value = map.get("value");
  if (value === undefined) throw new Test262Error("stored value is missing");
  return value;
}
const map = new Map<string, number>();
insert(map);
const value: number = read(map);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
