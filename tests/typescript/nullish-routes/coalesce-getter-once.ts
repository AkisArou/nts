/*---
description: "A nullable getter is read once before evaluating the right operand. Route: class getter"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-class, ts-accessors]
---*/

// A nullable getter is read once before evaluating the right operand. Route: class getter. Node prints coalesce-getter-once:ok.
const log: string[] = [];
class Cell {
  private current: number | null = null;
  get value(): number | null { log.push("get"); return this.current; }
}
function fallback(): number { log.push("rhs"); return 6; }
function read(cell: Cell): number {
  const result = cell.value ?? fallback();
  return result;
}
assert.sameValue(read(new Cell()), 6);
assert.compareArray(log, ["get", "rhs"]);
console.log("coalesce-getter-once:ok");
