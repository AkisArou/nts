/*---
description: A number parameter of a bivariant method receives the actual string passed by a wider caller.
features: [ts-unsound-bivariance, ts-functions, ts-typeof-operator, ts-conversions, ts-objects]
---*/
// TypeScript accepts the narrower method parameter by bivariance, so the
// unknown-typed caller can pass a string. Node gives the method that string.
function inject(sink: { put(value: unknown): void }): void {
  sink.put("7");
}
let calls = 0;
const sink = {
  put(value: number): void {
    calls++;
    assert.sameValue(typeof value, "string");
    assert.sameValue(String(value + 1), "71");
  }
};
inject(sink);
assert.sameValue(calls, 1);
