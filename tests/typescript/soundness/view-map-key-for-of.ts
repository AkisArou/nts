/*---
description: A readonly Map view preserves an aliased string key through for-of iteration.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-bivariance, ts-template-literals]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric key type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<number, number>([[2, 20]]);
const map: ReadonlyMap<number, number> = mutable;
const wider: Map<unknown, number> = mutable;
wider.set("7", 70);
const seen: string[] = [];
for (const entry of map) {
  seen.push(`${typeof entry[0]}:${entry[0] + 1}`);
}
assert.compareArray(seen, ["number:3", "string:71"]);
