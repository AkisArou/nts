/*---
description: A shared reference read through an object union keeps alias identity during a field write.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-interfaces, ts-unions, ts-narrowing, ts-numbers, ts-strings]
---*/
// NumericRef|TextualRef exposes one shared reference without narrowing; node retains its identity and alias writes before the member-specific in branch.
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
function inspect(value: NumericRef | TextualRef, expected: ObjectRow): void {
  const shared = value.shared; same(shared, expected.shared); shared.id = expected.next;
  same(value.shared.id, expected.next); same(expected.shared.id, expected.next);
  if ("num" in value) { log.push("number"); same(value, expected.numeric); same(value.num, expected.numExpected); }
  else { log.push("text"); same(value, expected.textual); same(value.str, expected.strExpected); }
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.textual, row);
assert.compareArray(log, ["number", "text", "number", "text"]);
