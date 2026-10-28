/*---
description: Set forEach supplies the actual string in both number-typed callback positions.
features: [ts-unsound-bivariance, ts-map-set, ts-functions, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's method bivariance accepts a wider Set parameter that adds a
// string. Node passes that same string in both narrow forEach value positions.
function insert(set: Set<unknown>): void {
  set.add("7");
}
const set = new Set<number>([2]);
insert(set);
const seen: string[] = [];
set.forEach((value, key, owner) => {
  assert.sameValue(owner, set);
  seen.push(`${typeof value}:${value + 1}/${typeof key}:${key + 1}`);
});
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
