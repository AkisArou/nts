/*---
description: Array.from passes an injected string to its mapper through a number-typed Set.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions]
---*/
// TypeScript's bivariant Set methods permit a wider writer to insert a string
// while readers still expect numbers. Node preserves the string through this read.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const seen = Array.from(set, (value: number) => typeof value + ":" + String(value + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
