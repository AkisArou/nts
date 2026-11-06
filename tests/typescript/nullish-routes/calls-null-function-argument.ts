/*---
description: "A null function suppresses its optional call argument. Route: nullable callback parameter"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A null function suppresses its optional call argument. Route: nullable callback parameter. Node prints calls-null-function-argument:ok.
const log: string[] = [];
function arg(): number { log.push("arg"); return 3; }
function run(fn: ((x: number) => number) | null): number | undefined {
  const result = fn?.(arg());
  return result;
}
assert.sameValue(run(null), undefined);
assert.compareArray(log, []);
console.log("calls-null-function-argument:ok");
