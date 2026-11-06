/*---
description: "An unsuccessful Map.get suppresses optional function arguments. Route: Map of callbacks"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An unsuccessful Map.get suppresses optional function arguments. Route: Map of callbacks. Node prints calls-map-function-missing:ok.
const log: string[] = [];
const values = new Map<string, (n: number) => number>();
function arg(): number { log.push("arg"); return 3; }
function read(key: string): number | undefined {
  const result = values.get(key)?.(arg());
  return result;
}
assert.sameValue(read("absent"), undefined);
assert.compareArray(log, []);
console.log("calls-map-function-missing:ok");
