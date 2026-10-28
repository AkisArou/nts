/*---
description: Array.from without a mapper copies the string stored in a number-typed Set.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays]
---*/
// TypeScript's bivariant Set methods permit a wider writer to insert a string
// while readers still expect numbers. Node preserves the string through this read.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const copied: number[] = Array.from(set);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1], "string");
assert.sameValue(String(copied[1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[2,"7"]');
