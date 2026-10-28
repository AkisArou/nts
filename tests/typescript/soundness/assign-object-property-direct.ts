/*---
description: Object.assign can overwrite a numeric property with a string.
features: [ts-unsound-object-assign, ts-objects, ts-functions, ts-typeof-operator, ts-conversions]
---*/

// TypeScript accepts Object.assign but keeps the original target's numeric property type.
// The existing property holds the source string afterward; node concatenates it.
const cell = { value: 1 };
Object.assign(cell, { value: "7" });
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
