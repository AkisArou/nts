/*---
description: "An absent optional tuple callback skips an argument. Route: tuple with optional callback tail (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An absent optional tuple callback skips an argument. Route: tuple with optional callback tail. Node prints calls-tuple-optional-missing:ok.
const log: string[] = [];
type Pair = [number, ((x: number) => number)?];
function arg(): number { log.push("arg"); return 2; }
function read(pair: Pair): number | undefined {
  const fn = pair[1]; const result = fn === null || fn === undefined ? undefined : fn.call(undefined, arg());
  return result;
}
assert.sameValue(read([7]), undefined);
assert.compareArray(log, []);
console.log("calls-tuple-optional-missing:ok");
