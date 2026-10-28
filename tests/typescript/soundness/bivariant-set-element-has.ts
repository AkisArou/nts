/*---
description: Set has preserves the string identity of an element read through its number type.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-destructuring, ts-typeof-operator]
---*/
// TypeScript's method bivariance allows Set<number> to widen to Set<unknown>
// and receive a string. Node keeps the string's identity in membership tests.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>();
insert(set);
// Recover the existing nominal-number member to call the narrow has method.
const [value] = set;
assert.sameValue(typeof value, "string");
assert.sameValue(set.has(value), true);
assert.sameValue(set.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(value), "string");
