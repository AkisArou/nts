/*---
description: "An optional tuple function element calls when populated. Route: tuple with optional callback tail"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An optional tuple function element calls when populated. Route: tuple with optional callback tail. Node prints calls-tuple-optional-present:ok.
type Pair = [number, ((x: number) => number)?];
function read(pair: Pair): number | undefined {
  const result = pair[1]?.(pair[0]);
  return result;
}
assert.sameValue(read([7, n => n + 1]), 8);
console.log("calls-tuple-optional-present:ok");
