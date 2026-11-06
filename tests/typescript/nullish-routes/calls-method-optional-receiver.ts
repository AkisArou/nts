/*---
description: "Optional method calling preserves the object receiver. Route: interface optional method with explicit this"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// Optional method calling preserves the object receiver. Route: interface optional method with explicit this. Node prints calls-method-optional-receiver:ok.
interface Host { value: number; method?: (this: Host) => number }
function read(host: Host): number | undefined {
  const result = host.method?.();
  return result;
}
const host: Host = { value: 14, method() { return this.value; } };
assert.sameValue(read(host), 14);
console.log("calls-method-optional-receiver:ok");
