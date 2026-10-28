/*---
description: A union-key generic write puts a string in a numeric property.
features: [ts-unsound-generic-widening, ts-generics, ts-keyof, ts-indexed-access, ts-unions, ts-objects, ts-typeof-operator, ts-conversions, ts-typeof-type]
---*/

// TypeScript accepts the union of both property types for a union key parameter.
// The runtime key is the numeric property; node preserves the assigned string.
function put<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}
const cell = { value: 1, label: "safe" };
put<typeof cell, "value" | "label">(cell, "value", "7");
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
