/*---
description: "A present middle candidate skips the third coalescing stage. Route: nullable number parameters"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-functions, ts-numbers]
---*/

// A present middle candidate skips the third coalescing stage. Route: nullable number parameters. Node prints coalesce-chain-middle:ok.
const log: string[] = [];
function choose(first: number | null, second: number | null): number {
  function middle(): number | null { log.push("middle"); return second; }
  function last(): number { log.push("last"); return 9; }
  const result = first ?? middle() ?? last();
  return result;
}
assert.sameValue(choose(null, -0), -0);
assert.compareArray(log, ["middle"]);
console.log("coalesce-chain-middle:ok");
