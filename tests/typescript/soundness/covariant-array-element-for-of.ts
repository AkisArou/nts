/*---
description: For-of reads an injected string through the original numeric array type.
features: [ts-unsound-covariant-array, ts-arrays, ts-iteration, ts-template-literals, ts-conversions, ts-typeof-operator]
---*/
// TypeScript accepts number[] as unknown[], so the wider alias can append a
// string. Node's loop yields the real values, despite their numeric types.
function append(values: unknown[]): void {
  values.push("7");
}
const values: number[] = [2];
append(values);
const seen: string[] = [];
for (const value of values) {
  seen.push(`${typeof value}:${value + 1}`);
}
assert.compareArray(seen, ["number:3", "string:71"]);
