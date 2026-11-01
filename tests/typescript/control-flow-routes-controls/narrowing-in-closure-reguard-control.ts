/*---
description: "Control for narrowing-in-closure-reguard; A direct in guard finds the member replaced by a closure before checking its field kind."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-closures, ts-errors]
---*/
// A closure replaces NumberCell|StringCell while its original in narrowing is live; node tests the opposite field on the same binding, checks its typeof and reads the replacement payload and identity. The control directly rechecks a string kind and reads separate concrete fields.
interface NumberCell { value: number; }
interface StringCell { text: string; }
interface FlowRow { kind: string; n: number; s: string; numeric: NumberCell; textual: StringCell; }
function makeRow(kind: string, n: number, s: string): FlowRow { return { kind, n, s, numeric: { value: n }, textual: { text: s } }; }
const rows: FlowRow[] = [makeRow("number", -0, ""), makeRow("string", NaN, ""), makeRow("number", NaN, "tail"), makeRow("string", -0, "tail")];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: FlowRow, row: FlowRow): void {
  const log: unknown[] = [];
  function change(): void { value.kind = row.kind === "number" ? "string" : "number"; log.push("write", value.kind === "number" ? value.numeric : value.textual); }
  const enteringKind = value.kind;
  if (enteringKind === "number") {
    log.push("before:number", value.numeric, value.numeric.value, value.numeric.value.toFixed(1));
    change(); log.push("read");
    if (value.kind === "string") { if (typeof value.textual.text !== "string") throw new Test262Error("wrong text kind"); log.push("after:string", value.textual, value.textual.text, value.textual.text.length); }
    else log.push("after:number", value.numeric, value.numeric.value, value.numeric.value.toFixed(1));
  } else {
    log.push("before:string", value.textual, value.textual.text, value.textual.text.length);
    change(); log.push("read");
    if (value.kind === "number") { if (typeof value.numeric.value !== "number") throw new Test262Error("wrong numeric kind"); log.push("after:number", value.numeric, value.numeric.value, value.numeric.value.toFixed(1)); }
    else log.push("after:string", value.textual, value.textual.text, value.textual.text.length);
  }
  const before = row.kind === "number";
  const expected: unknown[] = before ? ["before:number", row.numeric, row.n, row.n.toFixed(1)] : ["before:string", row.textual, row.s, row.s.length];
  expected.push("write", before ? row.textual : row.numeric, "read");
  expected.push(before ? "after:string" : "after:number", before ? row.textual : row.numeric, before ? row.s : row.n, before ? row.s.length : row.n.toFixed(1));
  same(value.kind === "number" ? value.numeric : value.textual, before ? row.textual : row.numeric); assert.compareArray(log, expected);
}
for (const row of rows) inspect({ kind: row.kind, n: row.n, s: row.s, numeric: row.numeric, textual: row.textual }, row);
