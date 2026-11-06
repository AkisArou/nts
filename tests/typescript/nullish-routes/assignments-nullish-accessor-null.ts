/*---
description: "Nullish assignment reads then writes a null accessor. Route: logged class accessor"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment reads then writes a null accessor. Route: logged class accessor. Node prints assignments-nullish-accessor-null:ok.
const log: string[] = [];
class Cell {
  private value: number | null | undefined;
  constructor(value: number | null | undefined) { this.value = value; }
  get item(): number | null | undefined { log.push("get"); return this.value; }
  set item(value: number | null | undefined) { log.push("set"); this.value = value; }
  peek(): number | null | undefined { return this.value; }
}
function rhs(): number { log.push("rhs"); return 9; }
const cell = new Cell(null);
const result = (cell.item ??= rhs());
assert.sameValue(result, 9);
assert.sameValue(cell.peek(), 9);
assert.compareArray(log, ["get", "rhs", "set"]);
console.log("assignments-nullish-accessor-null:ok");
