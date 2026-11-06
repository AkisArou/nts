/*---
description: "Optional receiver call preserves this on a present host. Route: nullable interface with required method (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// Optional receiver call preserves this on a present host. Route: nullable interface with required method. Node prints calls-base-optional-receiver:ok.
interface Host { value: number; method(this: Host): number }
function read(host: Host | null): number | undefined {
  const receiver = host; const result = receiver === null || receiver === undefined ? undefined : receiver.method.call(receiver);
  return result;
}
const host: Host = { value: 15, method() { return this.value; } };
assert.sameValue(read(host), 15);
assert.sameValue(read(null), undefined);
console.log("calls-base-optional-receiver:ok");
