/*---
description: "A parenthesized method reference still keeps its optional call receiver. Route: interface with optional this-typed method (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A parenthesized method reference still keeps its optional call receiver. Route: interface with optional this-typed method. Node prints calls-parenthesized-optional-receiver:ok.
interface Host { value: number; method?: (this: Host) => number }
function read(host: Host): number | undefined {
  const fn = host.method; const result = fn === null || fn === undefined ? undefined : fn.call(host);
  return result;
}
const host: Host = { value: 17, method() { return this.value; } };
assert.sameValue(read(host), 17);
console.log("calls-parenthesized-optional-receiver:ok");
