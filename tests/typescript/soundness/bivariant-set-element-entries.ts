/*---
description: Set entries retains the string in both number-typed tuple positions.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-tuples, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript accepts the wider Set parameter by method bivariance. Its string
// insertion stays a string in both positions of every entry node yields.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const seen: string[] = [];
for (const entry of set.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0] + 1}/${typeof entry[1]}:${entry[1] + 1}`);
}
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
