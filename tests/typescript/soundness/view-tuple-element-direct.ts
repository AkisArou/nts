/*---
description: A readonly numeric tuple view preserves a mutated string through an indexed read.
features: [ts-unsound-covariant-view, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-readonly, ts-unsound-covariant-array]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: [number, boolean] = [0, true];
const values: readonly [number, boolean] = mutable;
const wider: [unknown, boolean] = mutable;
wider[0] = "7";
assert.sameValue(typeof values[0], "string");
assert.sameValue(String(values[0] + 1), "71");
assert.sameValue(values[0] === 7, false);
assert.sameValue(values[1], true);
