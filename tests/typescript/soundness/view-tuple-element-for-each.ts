/*---
description: A readonly numeric tuple view preserves a mutated string through a forEach callback.
features: [ts-unsound-covariant-view, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-readonly, ts-unsound-covariant-array, ts-unions, ts-narrowing]
---*/
// TypeScript retains the narrow readonly view while a mutable alias widens
// covariantly and writes a string. Node reads that same string through the view.
const mutable: [number, boolean] = [0, true];
const values: readonly [number, boolean] = mutable;
const wider: [unknown, boolean] = mutable;
wider[0] = "7";
const seen: string[] = [];
values.forEach((value: number | boolean) => {
  if (typeof value === "boolean") seen.push("boolean:" + String(value));
  else seen.push(typeof value + ":" + String(value + 1));
});
assert.compareArray(seen, ["string:71", "boolean:true"]);
