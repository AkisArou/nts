/*---
description: Replacing a discriminated object union in one field preserves its payload layout and identity.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-interfaces, ts-unions, ts-discriminated-unions, ts-narrowing, ts-numbers, ts-strings]
---*/
// A holder alternates NumberObject|TextObject in one field; its discriminant selects the current payload and node preserves the packet and shared reference.
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
const holder: { value: NumberObject | TextObject } = { value: rows[0].numeric };
for (const row of rows) {
  holder.value = row.kind === "number" ? row.numeric : row.textual;
  const current = holder.value;
  same(current.ref, point);
  if (current.kind === "number") { log.push("number"); same(current, row.numeric); same(current.payload, row.numExpected); }
  else { log.push("text"); same(current, row.textual); same(current.payload, row.strExpected); }
}
assert.compareArray(log, ["number", "text", "number", "text"]);
