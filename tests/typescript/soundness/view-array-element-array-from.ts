/*---
description: A readonly numeric array view preserves a mutated string through an Array.from copy.
features: [ts-unsound-covariant-view, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-covariant-array]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: number[] = [2, 0];
const values: readonly number[] = mutable;
const wider: unknown[] = mutable;
wider[1] = "7";
const copy: number[] = Array.from(values);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(String(copy[1] + 1), "71");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
