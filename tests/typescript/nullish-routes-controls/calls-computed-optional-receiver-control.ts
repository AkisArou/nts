/*---
description: "Computed optional receiver call retains the method's this. Route: nullable interface and computed literal method name (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// Computed optional receiver call retains the method's this. Route: nullable interface and computed literal method name. Node prints calls-computed-optional-receiver:ok.
interface Host { value: number; method(this: Host): number }
function read(host: Host | undefined): number | undefined {
  const receiver = host; const result = receiver === null || receiver === undefined ? undefined : receiver["method"].call(receiver);
  return result;
}
const host: Host = { value: 16, method() { return this.value; } };
assert.sameValue(read(host), 16);
assert.sameValue(read(undefined), undefined);
console.log("calls-computed-optional-receiver:ok");
