/*---
description: An in guard distinguishes two object-union layouts after a typed call.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-narrowing, ts-numbers, ts-strings]
---*/
// NumberMember|TextMember enters a typed parameter; in chooses its own field and node keeps shared and outer object identity plus -0, NaN and empty text.
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
function inspect(value: NumberMember | TextMember, expected: NarrowRow): void {
  same(value.shared, point);
  if ("num" in value) { log.push("number"); same(value, expected.numeric); same(value.num, expected.numExpected); }
  else { log.push("text"); same(value, expected.textual); same(value.str, expected.strExpected); }
}
for (const row of rows) {
  const value: NumberMember | TextMember = row.kind === "number" ? row.numeric : row.textual;
  inspect(value, row);
}
assert.compareArray(log, ["number", "text", "number", "text"]);
