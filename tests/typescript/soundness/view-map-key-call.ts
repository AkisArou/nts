/*---
description: A readonly Map view preserves an aliased string key through a numeric parameter.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric key type. Node reads the stored
// string through that readonly view without changing its identity.
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const mutable = new Map<number, number>();
const map: ReadonlyMap<number, number> = mutable;
const wider: Map<unknown, number> = mutable;
wider.set("7", 70);
const [key] = map.keys();
assert.sameValue(describe(key), "string:71");
