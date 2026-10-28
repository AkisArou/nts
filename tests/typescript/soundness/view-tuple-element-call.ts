/*---
description: A readonly numeric tuple view preserves a mutated string through a numeric parameter.
features: [ts-unsound-covariant-view, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-readonly, ts-unsound-covariant-array]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: [number, boolean] = [0, true];
const values: readonly [number, boolean] = mutable;
const wider: [unknown, boolean] = mutable;
wider[0] = "7";
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[0]), "string:71");
assert.sameValue(values[1], true);
