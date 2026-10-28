/*---
description: The Set copy constructor preserves a string stored in a number-typed Set.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's method bivariance permits the wider Set parameter's string
// insertion. Node copies the actual string, preserving its type and identity.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const copy = new Set(set);
const seen: string[] = [];
for (const value of copy) {
  seen.push(`${typeof value}:${value + 1}`);
  assert.sameValue(copy.has(value), true);
}
assert.sameValue(copy.has(7), false);
assert.compareArray(seen, ["number:3", "string:71"]);
