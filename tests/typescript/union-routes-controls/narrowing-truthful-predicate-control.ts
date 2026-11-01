/*---
description: Control for narrowing-truthful-predicate; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-numbers, ts-strings]
---*/
// Replace the predicate with a boolean kind test over separate concrete member fields, keeping its call log and every payload check.
interface NumberMember { num: number; shared: { id: number }; }
interface TextMember { str: string; shared: { id: number }; }
interface NarrowRow { kind: string; numExpected: number; strExpected: string; numeric: NumberMember; textual: TextMember; }
const point = { id: 7 };
const rows: NarrowRow[] = [
  { numExpected: -0, strExpected: "unused", kind: "number", numeric: { num: -0, shared: point }, textual: { str: "unused", shared: point } },
  { numExpected: 81, strExpected: "", kind: "text", numeric: { num: 81, shared: point }, textual: { str: "", shared: point } },
  { numExpected: NaN, strExpected: "unused", kind: "number", numeric: { num: NaN, shared: point }, textual: { str: "unused", shared: point } },
  { numExpected: 82, strExpected: "tail", kind: "text", numeric: { num: 82, shared: point }, textual: { str: "tail", shared: point } }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function isNumber(value: NarrowRow): boolean {
  const result = value.kind === "number"; log.push(result ? "guard:number" : "guard:text"); return result;
}
function inspect(value: NarrowRow, expected: NarrowRow): void {
  if (isNumber(value)) { log.push("number"); same(value.numeric, expected.numeric); same(value.numeric.num, expected.numExpected); same(value.numeric.shared, point); }
  else { log.push("text"); same(value.textual, expected.textual); same(value.textual.str, expected.strExpected); same(value.textual.shared, point); }
}
for (const row of rows) inspect({ kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual }, row);
assert.compareArray(log, ["guard:number", "number", "guard:text", "text", "guard:number", "number", "guard:text", "text"]);
