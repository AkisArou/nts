/*---
description: "Computed nullish assignment evaluates object, key, getter, RHS and setter exactly in that order. Route: logged class accessor on computed key (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Computed nullish assignment evaluates object, key, getter, RHS and setter exactly in that order. Route: logged class accessor on computed key. Node prints assignments-computed-accessor-order:ok.
const log: string[] = [];
class Slot {
  private current: number | null;
  constructor(current: number | null) { this.current = current; }
  get item(): number | null { log.push("get"); return this.current; }
  set item(value: number | null) { log.push("set"); this.current = value; }
  peek(): number | null { return this.current; }
}
const cell = new Slot(null);
function target(): Slot { log.push("object"); return cell; }
function key(): "item" { log.push("key"); return "item"; }
function rhs(): number { log.push("rhs"); return 8; }
const object = target(); const property = key(); const saved = object[property];
let result: number | null = saved;
if (saved === null || saved === undefined) { const next = rhs(); object[property] = next; result = next; }
assert.sameValue(result, 8);
assert.sameValue(cell.peek(), 8);
assert.compareArray(log, ["object", "key", "get", "rhs", "set"]);
console.log("assignments-computed-accessor-order:ok");
