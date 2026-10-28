/*---
description: Explicit generic widening leaves a string in a numeric Map value through a numeric parameter.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const map = new Map<string, number>();
insert<unknown>(map, "7");
const value = map.get("value");
if (value === undefined) throw new Test262Error("stored value is missing");
assert.sameValue(describe(value), "string:71");
