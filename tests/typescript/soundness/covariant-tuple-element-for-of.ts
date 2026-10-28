/*---
description: A covariant write preserves the string through for-of iteration of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-unions, ts-narrowing]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: [number, boolean] = [0, true];
const wider: [unknown, boolean] = values;
wider[0] = "7";
const seen: string[] = [];
for (const value of values) {
  if (typeof value === "boolean") seen.push("boolean:" + String(value));
  else seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["string:71", "boolean:true"]);
