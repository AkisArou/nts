/*---
description: "AND assignment keeps NaN without writing. Route: logged class accessor"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// AND assignment keeps NaN without writing. Route: logged class accessor. Node prints assignments-and-accessor-nan:ok.
const log: string[] = [];
class Cell {
  private value: number | null | undefined;
  constructor(value: number | null | undefined) { this.value = value; }
  get item(): number | null | undefined { log.push("get"); return this.value; }
  set item(value: number | null | undefined) { log.push("set"); this.value = value; }
  peek(): number | null | undefined { return this.value; }
}
function rhs(): number { log.push("rhs"); return 9; }
const cell = new Cell(NaN);
const result = (cell.item &&= rhs());
assert.sameValue(result, NaN);
assert.sameValue(cell.peek(), NaN);
assert.compareArray(log, ["get"]);
console.log("assignments-and-accessor-nan:ok");
