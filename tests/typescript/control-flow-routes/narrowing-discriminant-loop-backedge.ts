/*---
description: "A loop back edge carries each replacement into a fresh discriminant narrowing."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-discriminated-unions, ts-route-loop, ts-unions, ts-narrowing]
---*/
// A NumberCell|StringCell local alternates concrete objects three times; every branch, back edge, loop exit and post-loop payload operation is logged, and node returns the last identity.
interface NumberCell { kind: "number"; value: number; }
interface StringCell { kind: "string"; text: string; }
interface FlowRow { kind: string; n: number; s: string; numeric: NumberCell; textual: StringCell; }
function makeRow(kind: string, n: number, s: string): FlowRow { return { kind, n, s, numeric: { kind: "number", value: n }, textual: { kind: "string", text: s } }; }
const rows: FlowRow[] = [makeRow("number", -0, ""), makeRow("string", NaN, ""), makeRow("number", NaN, "tail"), makeRow("string", -0, "tail")];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: NumberCell | StringCell, row: FlowRow): void {
  const log: unknown[] = [];
  for (let step = 0; step < 3; step++) {
    if (value.kind === "number") { log.push("number", step, value, value.value, value.value.toFixed(1)); value = row.textual; }
    else { log.push("string", step, value, value.text, value.text.length); value = row.numeric; }
    log.push("back", step, value);
  }
  log.push("exit", value);
  if (value.kind === "number") log.push("after:number", value.value, value.value.toFixed(1));
  else log.push("after:string", value.text, value.text.length);
  const expected: unknown[] = []; let numeric = row.kind === "number";
  for (let step = 0; step < 3; step++) {
    expected.push(numeric ? "number" : "string", step, numeric ? row.numeric : row.textual, numeric ? row.n : row.s, numeric ? row.n.toFixed(1) : row.s.length);
    numeric = !numeric; expected.push("back", step, numeric ? row.numeric : row.textual);
  }
  expected.push("exit", numeric ? row.numeric : row.textual, numeric ? "after:number" : "after:string", numeric ? row.n : row.s, numeric ? row.n.toFixed(1) : row.s.length);
  same(value, numeric ? row.numeric : row.textual); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.textual, row);
