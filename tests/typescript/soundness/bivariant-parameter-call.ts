/*---
description: A string in a bivariant method's number parameter reaches another number parameter unchanged.
features: [ts-unsound-bivariance, ts-functions, ts-typeof-operator, ts-conversions, ts-objects]
---*/
// TypeScript accepts the narrower method parameter by bivariance, so the
// unknown-typed caller can pass a string. Node gives the method that string.
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
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
inject(sink);
assert.sameValue(calls, 1);
