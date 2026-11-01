/*---
description: Control for objects-discriminant-field-replacement; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-interfaces, ts-numbers, ts-strings]
---*/
// Replace the holder with an explicit kind record containing separate concrete object fields; select the original object by kind.
interface NumberObject { kind: "number"; payload: number; ref: { id: number }; }
interface TextObject { kind: "text"; payload: string; ref: { id: number }; }
interface ObjectRow { kind: string; numExpected: number; strExpected: string; numeric: NumberObject; textual: TextObject; }
const point = { id: 7 };
const rows: ObjectRow[] = [
  { numExpected: -0, strExpected: "unused", kind: "number", numeric: { kind: "number", payload: -0, ref: point }, textual: { kind: "text", payload: "unused", ref: point } },
  { numExpected: 91, strExpected: "", kind: "text", numeric: { kind: "number", payload: 91, ref: point }, textual: { kind: "text", payload: "", ref: point } },
  { numExpected: NaN, strExpected: "unused", kind: "number", numeric: { kind: "number", payload: NaN, ref: point }, textual: { kind: "text", payload: "unused", ref: point } },
  { numExpected: 92, strExpected: "tail", kind: "text", numeric: { kind: "number", payload: 92, ref: point }, textual: { kind: "text", payload: "tail", ref: point } }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const holder: { value: ObjectRow } = { value: rows[0] };
for (const row of rows) {
  holder.value = { kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual };
  const current = holder.value;
  if (current.kind === "number") { same(current.numeric.ref, point); log.push("number"); same(current.numeric, row.numeric); same(current.numeric.payload, row.numExpected); }
  else { same(current.textual.ref, point); log.push("text"); same(current.textual, row.textual); same(current.textual.payload, row.strExpected); }
}
assert.compareArray(log, ["number", "text", "number", "text"]);
