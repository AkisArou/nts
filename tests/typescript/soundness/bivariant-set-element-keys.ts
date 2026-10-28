/*---
description: Set keys yields a string stored through a wider Set parameter.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's method bivariance allows this Set<number> to widen and receive
// a string. Node's keys iterator retains the string and its plus behavior.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const seen: string[] = [];
for (const key of set.keys()) {
  seen.push(typeof key + ":" + String(key + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
