/*---
description: Explicit generic widening leaves a string in a numeric Set element through a forEach callback.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-template-literals]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const seen: string[] = [];
set.forEach((value, key, owner) => {
  assert.sameValue(owner, set);
  seen.push(`${typeof value}:${value + 1}/${typeof key}:${key + 1}`);
});
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
