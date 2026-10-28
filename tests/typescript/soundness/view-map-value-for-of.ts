/*---
description: A readonly Map view preserves an aliased string value through for-of iteration.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-bivariance, ts-template-literals]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<string, number>([["control", 2]]);
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const seen: string[] = [];
for (const entry of map) {
  seen.push(`${typeof entry[1]}:${entry[1] + 1}`);
}
assert.compareArray(seen, ["number:3", "string:71"]);
