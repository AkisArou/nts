/*---
description: "A typed read after a closure write rechecks the current discriminant member."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-discriminated-unions, ts-closures, ts-unions, ts-narrowing]
---*/
// A closure replaces NumberCell|StringCell after an initial guard; a declared union-returning reader reloads it, and node logs and returns the replacement with its member-only operation.
interface NumberCell { kind: "number"; value: number; }
interface StringCell { kind: "string"; text: string; }
interface FlowRow { kind: string; n: number; s: string; numeric: NumberCell; textual: StringCell; }
function makeRow(kind: string, n: number, s: string): FlowRow { return { kind, n, s, numeric: { kind: "number", value: n }, textual: { kind: "string", text: s } }; }
const rows: FlowRow[] = [makeRow("number", -0, ""), makeRow("string", NaN, ""), makeRow("number", NaN, "tail"), makeRow("string", -0, "tail")];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: NumberCell | StringCell, row: FlowRow): void {
  const log: unknown[] = [];
  function read(): NumberCell | StringCell { log.push("read"); return value; }
  function change(): void { value = row.kind === "number" ? row.textual : row.numeric; log.push("write", value); }
  let after: NumberCell | StringCell;
  if (value.kind === "number") {
    log.push("before:number", value, value.value, value.value.toFixed(1));
    change(); after = read();
    if (after.kind === "number") log.push("after:number", after, after.value, after.value.toFixed(1));
    else log.push("after:string", after, after.text, after.text.length);
  } else {
    log.push("before:string", value, value.text, value.text.length);
    change(); after = read();
    if (after.kind === "number") log.push("after:number", after, after.value, after.value.toFixed(1));
    else log.push("after:string", after, after.text, after.text.length);
  }
  const before = row.kind === "number";
  const expected: unknown[] = before ? ["before:number", row.numeric, row.n, row.n.toFixed(1)] : ["before:string", row.textual, row.s, row.s.length];
  expected.push("write", before ? row.textual : row.numeric, "read");
  expected.push(before ? "after:string" : "after:number", before ? row.textual : row.numeric, before ? row.s : row.n, before ? row.s.length : row.n.toFixed(1));
  same(after, before ? row.textual : row.numeric); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.textual, row);
