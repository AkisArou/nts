/*---
description: A covariant write preserves the string through entries iteration of a numeric array slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: number[] = [2, 0];
const wider: unknown[] = values;
wider[1] = "7";
const seen: string[] = [];
for (const entry of values.entries()) {
  seen.push(entry[0] + ":" + typeof entry[1] + ":" + String(entry[1] + 1));
}
assert.compareArray(seen, ["0:number:3", "1:string:71"]);
