/*---
description: An accepted overload result can carry a string into a numeric parameter.
features: [ts-unsound-overload, ts-overloads, ts-functions, ts-unions, ts-typeof-operator, ts-conversions]
---*/

// TypeScript accepts the number overload against a number|string implementation result.
// The implementation returns a string for the numeric input; node keeps it across the call.
function claim(value: number): number;
function claim(value: string): string;
function claim(value: number | string): number | string { return String(value); }
function observe(value: number): void {
  assert.sameValue(typeof value, "string");
  assert.sameValue(String(value + 1), "71");
}
observe(claim(7));
