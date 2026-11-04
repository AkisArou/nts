/*---
description: "Control for assignments-nullish-private-accessor; Private nullish assignment uses the saved getter result despite the getter changing its backing field."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-class, ts-class-fields, ts-private-fields, ts-accessors, ts-this, ts-unions, ts-null-undefined, ts-tuples, ts-type-aliases, ts-typeof-operator, ts-destructuring]
---*/
// A private accessor carries ??=; node skips RHS and setter for saved non-nullish values even after the getter changes storage, and otherwise returns the untransformed RHS. The control saves each step in order.
const log: string[] = [];
type Value = number | null | undefined;
class Cell {
  #raw: Value;
  constructor(value: Value) { log.push("new"); this.#raw = value; }
  get #item(): Value { log.push(`get:${String(this.#raw)}`); const saved = this.#raw; this.#raw = 99; return saved; }
  set #item(value: Value) { log.push(`set:${String(value)}`); this.#raw = typeof value === "number" ? value + 10 : value; }
  rhs(): number { log.push(`rhs:${String(this.#raw)}`); this.#raw = 200; return 3; }
  update(): number { log.push("update"); const before = this.#item;
    if (before !== null && before !== undefined) return before;
    const rhs = this.rhs;
    const value = rhs.call(this);
    this.#item = value;
    return value; }
  read(): Value { log.push("read"); return this.#raw; }
}
const rows: [Value, boolean][] = [[undefined, true], [null, true], [0, false], [-0, false], [NaN, false], [7, false]];
for (const [initial, write] of rows) {
  const cell = new Cell(initial); log.length = 0; const result = cell.update(); const stored = cell.read();
  const expected = ["update", `get:${String(initial)}`]; if (write) expected.push("rhs:99", "set:3"); expected.push("read");
  assert.compareArray(log, expected);
  assert.sameValue(result, write ? 3 : initial); assert.sameValue(typeof result, "number"); assert.sameValue(stored, write ? 13 : 99);
}
