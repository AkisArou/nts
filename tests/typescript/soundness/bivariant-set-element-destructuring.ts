/*---
description: Destructuring a number-typed Set binds its injected string element unchanged.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring]
---*/
// TypeScript's bivariant Set methods permit a wider writer to insert a string
// while readers still expect numbers. Node preserves the string through this read.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>();
insert(set);
const [value] = set;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(value === 7, false);
