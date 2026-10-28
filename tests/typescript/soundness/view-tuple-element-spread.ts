/*---
description: A readonly numeric tuple view preserves a mutated string through a spread copy.
features: [ts-unsound-covariant-view, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-readonly, ts-unsound-covariant-array, ts-unions, ts-narrowing]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: [number, boolean] = [0, true];
const values: readonly [number, boolean] = mutable;
const wider: [unknown, boolean] = mutable;
wider[0] = "7";
const copy = [...values];
const value = copy[0];
if (typeof value === "boolean") throw new Test262Error("numeric slot became boolean");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(JSON.stringify(copy), '["7",true]');
