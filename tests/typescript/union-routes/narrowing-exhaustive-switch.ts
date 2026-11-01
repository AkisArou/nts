/*---
description: An exhaustive discriminant switch retains each typed packet payload and identity.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-discriminated-unions, ts-narrowing, ts-never, ts-numbers, ts-strings]
---*/
// NumberPacket|TextPacket|RefPacket reaches an exhaustive switch with never; node takes each discriminant branch and preserves the exact payload and packet.
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
function inspect(value: NumberPacket | TextPacket | RefPacket, expected: NarrowRow): void {
  switch (value.kind) {
    case "number": log.push("number"); same(value, expected.numeric); same(value.payload, expected.numExpected); break;
    case "text": log.push("text"); same(value, expected.textual); same(value.payload, expected.strExpected); break;
    case "ref": log.push("ref"); same(value, expected.reference); same(value.payload, point); break;
    default: { const exhausted: never = value; throw new Test262Error(String(exhausted)); }
  }
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.kind === "text" ? row.textual : row.reference, row);
assert.compareArray(log, ["number", "text", "ref", "number"]);
