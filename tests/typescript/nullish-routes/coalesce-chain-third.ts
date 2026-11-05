/*---
description: "Two null candidates select the final coalescing stage once. Route: nullable boolean parameters"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-functions, ts-unions]
---*/

// Two null candidates select the final coalescing stage once. Route: nullable boolean parameters. Node prints coalesce-chain-third:ok.
const log: string[] = [];
function choose(first: boolean | null, second: boolean | null): boolean {
  function middle(): boolean | null { log.push("middle"); return second; }
  function last(): boolean { log.push("last"); return false; }
  const result = first ?? middle() ?? last();
  return result;
}
assert.sameValue(choose(null, null), false);
assert.compareArray(log, ["middle", "last"]);
console.log("coalesce-chain-third:ok");
