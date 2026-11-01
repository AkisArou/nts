/*---
description: "A branch replacement invalidates a class narrowing at a control-flow join."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-instanceof, ts-unions, ts-narrowing]
---*/
// NumberCell|StringCell is optionally replaced inside its instanceof arm; node logs the chosen class, payload operation and original or replacement identity at the join.
class NumberCell { value: number; constructor(value: number) { this.value = value; } }
class StringCell { text: string; constructor(text: string) { this.text = text; } }
interface FlowRow { kind: string; n: number; s: string; numeric: NumberCell; textual: StringCell; }
function makeRow(kind: string, n: number, s: string): FlowRow { return { kind, n, s, numeric: new NumberCell(n), textual: new StringCell(s) }; }
const rows: FlowRow[] = [makeRow("number", -0, ""), makeRow("string", NaN, ""), makeRow("number", NaN, "tail"), makeRow("string", -0, "tail")];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: NumberCell | StringCell, row: FlowRow, change: boolean): void {
  const log: unknown[] = [];
  if (value instanceof NumberCell) {
    log.push("before:number", value, value.value, value.value.toFixed(1));
    if (change) { value = row.textual; log.push("write:string", value); } else log.push("keep:number", value);
  } else {
    log.push("before:string", value, value.text, value.text.length);
    if (change) { value = row.numeric; log.push("write:number", value); } else log.push("keep:string", value);
  }
  if (value instanceof NumberCell) log.push("joined:number", value, value.value, value.value.toFixed(1));
  else log.push("joined:string", value, value.text, value.text.length);
  const before = row.kind === "number", after = change ? !before : before;
  const expected: unknown[] = before ? ["before:number", row.numeric, row.n, row.n.toFixed(1)] : ["before:string", row.textual, row.s, row.s.length];
  expected.push((change ? "write:" : "keep:") + (after ? "number" : "string"), after ? row.numeric : row.textual);
  expected.push(after ? "joined:number" : "joined:string", after ? row.numeric : row.textual, after ? row.n : row.s, after ? row.n.toFixed(1) : row.s.length);
  same(value, after ? row.numeric : row.textual); assert.compareArray(log, expected);
}
for (const row of rows) for (const change of [false, true]) inspect(row.kind === "number" ? row.numeric : row.textual, row, change);
