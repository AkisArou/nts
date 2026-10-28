/*---
description: A readonly Map view preserves an aliased string value through the Map copy constructor.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<string, number>();
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const copy = new Map(map);
const value = copy.get("value");
if (value === undefined) throw new Test262Error("copied value is missing");
assert.sameValue(copy.size, 1);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
