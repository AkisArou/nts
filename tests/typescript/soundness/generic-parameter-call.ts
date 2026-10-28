/*---
description: Explicit generic widening leaves a string in a numeric parameter through a numeric parameter.
features: [ts-unsound-generic-widening, ts-functions, ts-typeof-operator, ts-conversions, ts-generics, ts-objects]
---*/
// TypeScript accepts the numeric method at an explicit unknown instantiation
// by bivariance. The number parameter receives a string; node preserves it.
function inject<T>(sink: { put(value: T): void }, value: T): void {
  sink.put(value);
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
let calls = 0;
const sink = {
  put(value: number): void {
    calls++;
    assert.sameValue(describe(value), "string:71");
  }
};
inject<unknown>(sink, "7");
assert.sameValue(calls, 1);
