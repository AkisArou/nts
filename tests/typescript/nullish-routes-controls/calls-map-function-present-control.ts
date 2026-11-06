/*---
description: "An optionally called function from Map.get receives its argument. Route: Map of callbacks (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An optionally called function from Map.get receives its argument. Route: Map of callbacks. Node prints calls-map-function-present:ok.
const values = new Map<string, (n: number) => number>([["double", n => n * 2]]);
function read(key: string, value: number): number | undefined {
  const fn = values.get(key); const result = fn === null || fn === undefined ? undefined : fn.call(undefined, value);
  return result;
}
assert.sameValue(read("double", 5), 10);
console.log("calls-map-function-present:ok");
