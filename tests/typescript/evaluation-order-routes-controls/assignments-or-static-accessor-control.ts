/*---
description: "Control for assignments-or-static-accessor; Static logical-or assignment uses saved truthiness while getters and RHS change constructor state."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-static, ts-inheritance, ts-accessors, ts-this, ts-unions, ts-null-undefined, ts-tuples, ts-closures, ts-override, ts-type-aliases, ts-typeof-operator, ts-destructuring]
---*/
// A constructor-valued route carries ||=; node decides from the original getter result, skips forbidden RHS/setter calls, and writes the original static receiver when selected. The control saves each step in order.
const log: string[] = [];
type Value = number | string | boolean | null | undefined;
class Cell {
  static raw: Value = 0;
  static get item(): Value { log.push(`get:${typeof this.raw}`); const saved = this.raw; this.raw = "getter"; return saved; }
  static set item(value: Value) { log.push(`set:${String(value)}`); this.raw = `stored:${String(value)}`; }
}
class Other extends Cell { static override raw: Value = "other"; }
const rows: [Value, boolean][] = [[0, true], [-0, true], [NaN, true], ["", true], [false, true], [null, true], [undefined, true], [7, false], ["go", false], [true, false]];
for (const [initial, write] of rows) {
  Cell.raw = initial; Other.raw = "other"; let active: typeof Cell = Cell;
  function target(): typeof Cell { log.push("constructor"); return active; }
  function rhs(): number { log.push(`rhs:${String(Cell.raw)}`); Cell.raw = "rhs"; active = Other; return 5; }
  function run(): Value { log.push("run"); const receiver = target();
    const before = receiver.item;
    if (before) return before;
    const value = rhs();
    receiver.item = value;
    return value; }
  log.length = 0; const result = run();
  const expected = ["run", "constructor", `get:${typeof initial}`]; if (write) expected.push("rhs:getter", "set:5");
  assert.compareArray(log, expected);
  assert.sameValue(result, write ? 5 : initial); assert.sameValue(typeof result, write ? "number" : typeof initial);
  assert.sameValue(Cell.raw, write ? "stored:5" : "getter"); assert.sameValue(Other.raw, "other"); assert.sameValue(active, write ? Other : Cell);
}
