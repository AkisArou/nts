/*---
description: "An optionally called function from Map.get receives its argument. Route: Map of callbacks"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An optionally called function from Map.get receives its argument. Route: Map of callbacks. Node prints calls-map-function-present:ok.
const values = new Map<string, (n: number) => number>([["double", n => n * 2]]);
function read(key: string, value: number): number | undefined {
  const result = values.get(key)?.(value);
  return result;
}
assert.sameValue(read("double", 5), 10);
console.log("calls-map-function-present:ok");
