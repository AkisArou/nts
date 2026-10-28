/*---
description: A generic spread intersection preserves an overwritten string property.
features: [ts-unsound-generic-widening, ts-generics, ts-intersections, ts-spread, ts-objects, ts-typeof-operator, ts-conversions, ts-functions]
---*/

// TypeScript models generic spread with an intersection, retaining the left number claim.
// The right string property replaces it at runtime; node concatenates the string.
function merge<T, U>(left: T, right: U): T & U { return { ...left, ...right }; }
const cell: { value: number } = merge({ value: 1 }, { value: "7" });
const value: number = cell.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
