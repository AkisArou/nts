/*---
description: "An undefined function suppresses its optional call argument. Route: optional interface function field (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An undefined function suppresses its optional call argument. Route: optional interface function field. Node prints calls-undefined-function-argument:ok.
const log: string[] = [];
interface Field { callback?: (x: number) => number }
function arg(): number { log.push("arg"); return 2; }
function run(slot: Field): number | undefined {
  const saved = slot.callback; const result = saved === null || saved === undefined ? undefined : saved.call(slot, arg());
  return result;
}
assert.sameValue(run({}), undefined);
assert.compareArray(log, []);
console.log("calls-undefined-function-argument:ok");
