/*---
description: Explicit generic widening leaves a string in a numeric parameter through a numeric return.
features: [ts-unsound-generic-widening, ts-functions, ts-typeof-operator, ts-conversions, ts-generics, ts-objects]
---*/
// TypeScript accepts the numeric method at an explicit unknown instantiation
// by bivariance. The number parameter receives a string; node preserves it.
function invoke<T>(sink: { put(value: T): number }, value: T): number {
  return sink.put(value);
}
const sink = {
  put(value: number): number { return value; }
};
const value: number = invoke<unknown>(sink, "7");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
