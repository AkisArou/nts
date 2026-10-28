/*---
description: Set values yields a string even though its iterator element is typed number.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-template-literals, ts-typeof-operator]
---*/
// TypeScript permits the Set to widen by method bivariance, admitting a string
// that contradicts its element type. Node's values iterator returns the string.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const seen: string[] = [];
for (const value of set.values()) {
  seen.push(`${typeof value}:${value}`);
}
assert.compareArray(seen, ["number:2", "string:7"]);
