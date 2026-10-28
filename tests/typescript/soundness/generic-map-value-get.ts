/*---
description: Explicit generic widening leaves a string in a numeric Map value through a get lookup.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
const map = new Map<string, number>();
insert<unknown>(map, "7");
const value = map.get("value");
if (value === undefined) throw new Test262Error("stored value is missing");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(value === 7, false);
