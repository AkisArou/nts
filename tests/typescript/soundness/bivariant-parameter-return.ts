/*---
description: A numeric return preserves the string received by a bivariant method's number parameter.
features: [ts-unsound-bivariance, ts-functions, ts-typeof-operator, ts-conversions, ts-objects]
---*/
// TypeScript accepts the narrower method parameter by bivariance, so the
// unknown-typed caller can pass a string. Node gives the method that string.
function invoke(sink: { put(value: unknown): number }): number {
  return sink.put("7");
}
const sink = {
  put(value: number): number { return value; }
};
const value: number = invoke(sink);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
