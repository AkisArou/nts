/*---
description: A readonly Map view preserves an aliased string value through a numeric return.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
function read(map: ReadonlyMap<string, number>): number {
  const value = map.get("value");
  if (value === undefined) throw new Test262Error("stored value is missing");
  return value;
}
const mutable = new Map<string, number>();
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const value: number = read(map);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
