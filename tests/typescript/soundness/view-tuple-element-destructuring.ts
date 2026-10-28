/*---
description: A readonly numeric tuple view preserves a mutated string through destructuring.
features: [ts-unsound-covariant-view, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-readonly, ts-unsound-covariant-array]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: [number, boolean] = [0, true];
const values: readonly [number, boolean] = mutable;
const wider: [unknown, boolean] = mutable;
wider[0] = "7";
const [value, marker] = values;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(marker, true);
