/*---
description: Control for narrowing-exhaustive-switch; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-numbers, ts-strings]
---*/
// Use a string kind record with separate concrete packet fields; the same switch selects the payload and its default throws without a never claim.
interface NumberPacket { kind: "number"; payload: number; }
interface TextPacket { kind: "text"; payload: string; }
interface RefPacket { kind: "ref"; payload: { id: number }; }
interface NarrowRow { kind: string; numExpected: number; strExpected: string; numeric: NumberPacket; textual: TextPacket; reference: RefPacket; }
const point = { id: 7 };
const rows: NarrowRow[] = [
  { numExpected: -0, strExpected: "", kind: "number", numeric: { kind: "number", payload: -0 }, textual: { kind: "text", payload: "" }, reference: { kind: "ref", payload: point } },
  { numExpected: NaN, strExpected: "", kind: "text", numeric: { kind: "number", payload: NaN }, textual: { kind: "text", payload: "" }, reference: { kind: "ref", payload: point } },
  { numExpected: NaN, strExpected: "tail", kind: "ref", numeric: { kind: "number", payload: NaN }, textual: { kind: "text", payload: "tail" }, reference: { kind: "ref", payload: point } },
  { numExpected: NaN, strExpected: "tail", kind: "number", numeric: { kind: "number", payload: NaN }, textual: { kind: "text", payload: "tail" }, reference: { kind: "ref", payload: point } }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: NarrowRow, expected: NarrowRow): void {
  switch (value.kind) {
    case "number": log.push("number"); same(value.numeric, expected.numeric); same(value.numeric.payload, expected.numExpected); break;
    case "text": log.push("text"); same(value.textual, expected.textual); same(value.textual.payload, expected.strExpected); break;
    case "ref": log.push("ref"); same(value.reference, expected.reference); same(value.reference.payload, point); break;
    default: throw new Test262Error(value.kind);
  }
}
for (const row of rows) inspect({ kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual, reference: row.reference }, row);
assert.compareArray(log, ["number", "text", "ref", "number"]);
