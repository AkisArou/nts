/*---
description: A readonly numeric array view preserves a mutated string through values iteration.
features: [ts-unsound-covariant-view, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-covariant-array]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: number[] = [2, 0];
const values: readonly number[] = mutable;
const wider: unknown[] = mutable;
wider[1] = "7";
const seen: string[] = [];
for (const value of values.values()) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
