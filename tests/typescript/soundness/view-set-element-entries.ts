/*---
description: A readonly Set view preserves an aliased string element through entries iteration.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-readonly, ts-unsound-bivariance, ts-template-literals]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Set<number>([2]);
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const seen: string[] = [];
for (const entry of set.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0] + 1}/${typeof entry[1]}:${entry[1] + 1}`);
}
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
