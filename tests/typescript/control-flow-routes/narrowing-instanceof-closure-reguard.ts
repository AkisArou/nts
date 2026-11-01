/*---
description: "A direct instanceof guard reads a class member replaced by a closure inside the original narrowed branch."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-instanceof, ts-closures, ts-unions, ts-narrowing]
---*/
// A closure replaces NumberCell|StringCell while its original instanceof narrowing is live; node directly tests the same binding again and reads the replacement payload and identity.
class NumberCell { value: number; constructor(value: number) { this.value = value; } }
class StringCell { text: string; constructor(text: string) { this.text = text; } }
interface FlowRow { kind: string; n: number; s: string; numeric: NumberCell; textual: StringCell; }
function makeRow(kind: string, n: number, s: string): FlowRow { return { kind, n, s, numeric: new NumberCell(n), textual: new StringCell(s) }; }
const rows: FlowRow[] = [makeRow("number", -0, ""), makeRow("string", NaN, ""), makeRow("number", NaN, "tail"), makeRow("string", -0, "tail")];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: NumberCell | StringCell, row: FlowRow): void {
  const log: unknown[] = [];
  function change(): void { value = row.kind === "number" ? row.textual : row.numeric; log.push("write", value); }
  if (value instanceof NumberCell) {
    log.push("before:number", value, value.value, value.value.toFixed(1));
    change(); log.push("read");
    if (value instanceof StringCell) log.push("after:string", value, value.text, value.text.length);
    else log.push("after:number", value, value.value, value.value.toFixed(1));
  } else {
    log.push("before:string", value, value.text, value.text.length);
    change(); log.push("read");
    if (value instanceof NumberCell) log.push("after:number", value, value.value, value.value.toFixed(1));
    else log.push("after:string", value, value.text, value.text.length);
  }
  const before = row.kind === "number";
  const expected: unknown[] = before ? ["before:number", row.numeric, row.n, row.n.toFixed(1)] : ["before:string", row.textual, row.s, row.s.length];
  expected.push("write", before ? row.textual : row.numeric, "read");
  expected.push(before ? "after:string" : "after:number", before ? row.textual : row.numeric, before ? row.s : row.n, before ? row.s.length : row.n.toFixed(1));
  same(value, before ? row.textual : row.numeric); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.textual, row);
