/*---
description: A function returning a number preserves a string read from a number-typed Set.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions]
---*/
// TypeScript's bivariant Set methods permit a wider writer to insert a string
// while readers still expect numbers. Node preserves the string through this read.
function insert(set: Set<unknown>): void {
  set.add("7");
}
function first(set: Set<number>): number {
  const [value] = set;
  return value;
}
const set = new Set<number>();
insert(set);
const value: number = first(set);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
