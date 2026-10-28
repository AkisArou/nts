/*---
description: An array element retains undefined through a covariant write.
features: [ts-unsound-covariant-array, ts-arrays, ts-typeof-operator, ts-conversions, ts-null-undefined]
---*/

// TypeScript permits a wider mutable array alias to replace this initialized slot.
// Its narrow element claim is then false; node preserves the actual value and its conversions.
const values: number[] = [1];
const wide: unknown[] = values;
wide[0] = undefined;
const value: number = values[0];
assert.sameValue<unknown>(value, undefined);
assert.sameValue(typeof value, "undefined");
assert.sameValue(String(value), "undefined");
