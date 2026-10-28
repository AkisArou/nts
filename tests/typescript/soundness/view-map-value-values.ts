/*---
description: A readonly Map view preserves an aliased string value through values iteration.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<string, number>([["control", 2]]);
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const seen: string[] = [];
for (const value of map.values()) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
