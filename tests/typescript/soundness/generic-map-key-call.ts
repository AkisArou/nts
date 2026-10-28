/*---
description: Explicit generic widening leaves a string in a numeric Map key through a numeric parameter.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const map = new Map<number, number>();
insert<unknown>(map, "7");
const [key] = map.keys();
assert.sameValue(describe(key), "string:71");
