/*---
description: "AND assignment does not write numeric zero. Route: logged class accessor (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// AND assignment does not write numeric zero. Route: logged class accessor. Node prints assignments-and-accessor-zero:ok.
const log: string[] = [];
class Cell {
  private value: number | null | undefined;
  constructor(value: number | null | undefined) { this.value = value; }
  get item(): number | null | undefined { log.push("get"); return this.value; }
  set item(value: number | null | undefined) { log.push("set"); this.value = value; }
  peek(): number | null | undefined { return this.value; }
}
function rhs(): number { log.push("rhs"); return 9; }
const cell = new Cell(0);
const current = cell.item; let result: number | null | undefined = current;
if (current) { const next = rhs(); cell.item = next; result = next; }
assert.sameValue(result, 0);
assert.sameValue(cell.peek(), 0);
assert.compareArray(log, ["get"]);
console.log("assignments-and-accessor-zero:ok");
