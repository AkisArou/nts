/*---
description: "A present function evaluates its optional call argument once. Route: nullable function field"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A present function evaluates its optional call argument once. Route: nullable function field. Node prints calls-present-function-argument:ok.
const log: string[] = [];
interface Slot { callback: ((x: number) => number) | null }
function arg(): number { log.push("arg"); return 8; }
function run(slot: Slot): number | undefined {
  const result = slot.callback?.(arg());
  return result;
}
assert.sameValue(run({ callback(x) { log.push("call"); return x + 1; } }), 9);
assert.compareArray(log, ["arg", "call"]);
console.log("calls-present-function-argument:ok");
