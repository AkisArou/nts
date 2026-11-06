/*---
description: "A function-valued getter is evaluated exactly once by optional calling. Route: class method getter"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A function-valued getter is evaluated exactly once by optional calling. Route: class method getter. Node prints calls-method-getter-once:ok.
const log: string[] = [];
class Cell {
  value = 21;
  get method(): ((this: Cell) => number) | undefined {
    log.push("get");
    return function (this: Cell) { log.push("call"); return this.value; };
  }
}
function read(cell: Cell): number | undefined {
  const result = cell.method?.();
  return result;
}
assert.sameValue(read(new Cell()), 21);
assert.compareArray(log, ["get", "call"]);
console.log("calls-method-getter-once:ok");
