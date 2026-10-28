/*---
description: A string read through a number-typed Set reaches a number parameter unchanged.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions]
---*/
// TypeScript's bivariant Set methods permit a wider writer to insert a string
// while readers still expect numbers. Node preserves the string through this read.
function insert(set: Set<unknown>): void {
  set.add("7");
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const set = new Set<number>();
insert(set);
const [value] = set;
assert.sameValue(describe(value), "string:71");
