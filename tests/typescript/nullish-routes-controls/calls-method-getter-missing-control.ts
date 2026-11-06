/*---
description: "An absent function-valued getter skips its argument. Route: class getter returning undefined (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An absent function-valued getter skips its argument. Route: class getter returning undefined. Node prints calls-method-getter-missing:ok.
const log: string[] = [];
class Cell {
  get method(): ((value: number) => number) | undefined { log.push("get"); return undefined; }
}
function arg(): number { log.push("arg"); return 3; }
function read(cell: Cell): number | undefined {
  const fn = cell.method; const result = fn === null || fn === undefined ? undefined : fn.call(cell, arg());
  return result;
}
assert.sameValue(read(new Cell()), undefined);
assert.compareArray(log, ["get"]);
console.log("calls-method-getter-missing:ok");
