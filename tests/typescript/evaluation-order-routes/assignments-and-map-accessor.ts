/*---
description: "Logical-and assignment uses the original Map-backed getter value and avoids conversion when testing truthiness."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-map-set, ts-accessors, ts-this, ts-unions, ts-null-undefined, ts-tuples, ts-objects, ts-closures, ts-to-primitive, ts-type-aliases, ts-typeof-operator, ts-destructuring]
---*/
// A Map-backed interface accessor carries &&=; node decides before its getter replacement matters, writes only for truthy saved values, and returns zero before transformed storage.
const log: string[] = [];
interface Token { id: number; valueOf(): number; }
type Value = number | string | boolean | null | undefined | Token;
interface View { item: Value; }
class Cell implements View {
  table: Map<string, Value>;
  constructor(table: Map<string, Value>) { log.push("new"); this.table = table; }
  get item(): Value { const saved = this.table.get("slot"); log.push(`get:${typeof saved}`); this.table.set("slot", "getter"); return saved; }
  set item(value: Value) { log.push(`set:${String(value)}`); this.table.set("slot", `stored:${String(value)}`); }
}
const marker: Token = { id: 1, valueOf(): number { log.push("unexpected-conversion"); return 0; } };
const rows: [Value, boolean][] = [[0, false], [-0, false], [NaN, false], ["", false], [false, false], [null, false], [undefined, false], [7, true], ["go", true], [true, true], [marker, true]];
for (const [initial, write] of rows) {
  const table = new Map<string, Value>([["slot", initial]]), cell: View = new Cell(table);
  function rhs(): number { log.push(`rhs:${String(table.get("slot"))}`); table.set("slot", "rhs"); return 0; }
  function run(): Value { log.push("run"); return cell.item &&= rhs(); }
  log.length = 0; const result = run();
  const expected = ["run", `get:${typeof initial}`]; if (write) expected.push("rhs:getter", "set:0");
  assert.compareArray(log, expected);
  assert.sameValue(result, write ? 0 : initial); assert.sameValue(typeof result, write ? "number" : typeof initial);
  assert.sameValue(table.get("slot"), write ? "stored:0" : "getter"); assert.sameValue(table.size, 1);
}
