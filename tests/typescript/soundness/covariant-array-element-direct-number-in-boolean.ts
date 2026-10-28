/*---
description: An array element retains number-in-boolean through a covariant write.
features: [ts-unsound-covariant-array, ts-arrays, ts-typeof-operator, ts-conversions]
---*/

// TypeScript permits a wider mutable array alias to replace this initialized slot.
// Its narrow element claim is then false; node preserves the actual value and its conversions.
const values: boolean[] = [false];
const wide: unknown[] = values;
wide[0] = 7;
const value: boolean = values[0];
assert.sameValue(typeof value, "number");
assert.sameValue(String(value), "7");
assert.sameValue(JSON.stringify(value), "7");
