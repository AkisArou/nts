/*---
description: Control for objects-shared-reference-write; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-interfaces, ts-numbers, ts-strings]
---*/
// Select shared from the concrete member by kind, then perform the same alias write, member-field reread and exact payload checks.
interface NumericRef { num: number; shared: { id: number }; }
interface TextualRef { str: string; shared: { id: number }; }
interface ObjectRow { kind: string; numExpected: number; strExpected: string; numeric: NumericRef; textual: TextualRef; shared: { id: number }; next: number; }
const first = { id: 1 }, second = { id: 2 };
const rows: ObjectRow[] = [
  { numExpected: -0, strExpected: "unused", kind: "number", numeric: { num: -0, shared: first }, textual: { str: "unused", shared: second }, shared: first, next: NaN },
  { numExpected: 91, strExpected: "", kind: "text", numeric: { num: 91, shared: first }, textual: { str: "", shared: second }, shared: second, next: -0 },
  { numExpected: NaN, strExpected: "unused", kind: "number", numeric: { num: NaN, shared: second }, textual: { str: "unused", shared: first }, shared: second, next: 0 },
  { numExpected: 92, strExpected: "tail", kind: "text", numeric: { num: 92, shared: second }, textual: { str: "tail", shared: first }, shared: first, next: -0 }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: ObjectRow, expected: ObjectRow): void {
  const shared = value.kind === "number" ? value.numeric.shared : value.textual.shared; same(shared, expected.shared); shared.id = expected.next;
  const reread = value.kind === "number" ? value.numeric.shared : value.textual.shared;
  same(reread.id, expected.next); same(expected.shared.id, expected.next);
  if (value.kind === "number") { log.push("number"); same(value.numeric, expected.numeric); same(value.numeric.num, expected.numExpected); }
  else { log.push("text"); same(value.textual, expected.textual); same(value.textual.str, expected.strExpected); }
}
for (const row of rows) inspect({ kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual, shared: row.shared, next: row.next }, row);
assert.compareArray(log, ["number", "text", "number", "text"]);
