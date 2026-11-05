/*---
description: "A getter in an optional chain executes exactly once. Route: nullable class getter (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A getter in an optional chain executes exactly once. Route: nullable class getter. Node prints chains-getter-once:ok.
const log: string[] = [];
class Cell {
  get member(): { x: number } { log.push("get"); return { x: 10 }; }
}
function read(base: Cell | undefined): number | undefined {
  const saved = base; const result = saved === null || saved === undefined ? undefined : saved.member.x;
  return result;
}
assert.sameValue(read(new Cell()), 10);
assert.compareArray(log, ["get"]);
console.log("chains-getter-once:ok");
