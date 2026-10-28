/*---
description: A readonly numeric tuple view preserves a mutated string through a numeric reduction.
features: [ts-unsound-covariant-view, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-readonly, ts-unsound-covariant-array, ts-unions, ts-narrowing]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: [number, boolean] = [0, true];
const values: readonly [number, boolean] = mutable;
const wider: [unknown, boolean] = mutable;
wider[0] = "7";
const total = values.reduce<number>((sum: number, value: number | boolean) => {
  return typeof value === "boolean" ? sum : sum + value;
}, 2);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
