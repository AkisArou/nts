/*---
description: An array element retains number-in-string through a covariant write.
features: [ts-unsound-covariant-array, ts-arrays, ts-typeof-operator, ts-conversions]
---*/

// TypeScript permits a wider mutable array alias to replace this initialized slot.
// Its narrow element claim is then false; node preserves the actual value and its conversions.
const values: string[] = ["safe"];
const wide: unknown[] = values;
wide[0] = 7;
const value: string = values[0];
assert.sameValue(typeof value, "number");
assert.sameValue(String(value + 1), "8");
