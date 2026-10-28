/*---
description: A covariant write preserves the string through entries iteration of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-unions, ts-narrowing]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: [number, boolean] = [0, true];
const wider: [unknown, boolean] = values;
wider[0] = "7";
const seen: string[] = [];
for (const entry of values.entries()) {
  const value = entry[1];
  const text = typeof value === "boolean" ? "boolean:" + String(value) : typeof value + ":" + String(value + 1);
  seen.push(entry[0] + ":" + text);
}
assert.compareArray(seen, ["0:string:71", "1:boolean:true"]);
