/*---
description: Control for narrowing-in-member-fields; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-numbers, ts-strings]
---*/
// Pass a kind record holding both concrete object members and read the selected member field with a kind branch.
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
function inspect(value: NarrowRow, expected: NarrowRow): void {
  if (value.kind === "number") { same(value.numeric.shared, point); log.push("number"); same(value.numeric, expected.numeric); same(value.numeric.num, expected.numExpected); }
  else { same(value.textual.shared, point); log.push("text"); same(value.textual, expected.textual); same(value.textual.str, expected.strExpected); }
}
for (const row of rows) {
  const value: NarrowRow = { kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual };
  inspect(value, row);
}
assert.compareArray(log, ["number", "text", "number", "text"]);
