/*---
description: A shared numeric field is read through a class union whose members lay it out differently.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-class, ts-class-fields, ts-interfaces, ts-unions, ts-instanceof, ts-narrowing, ts-numbers, ts-strings]
---*/
// NumericObject|TextualObject exposes shared before narrowing despite different class field orders; node preserves the shared number and member-specific payload.
class NumericObject {
  amount: number; shared: number;
  constructor(amount: number, shared: number) { this.amount = amount; this.shared = shared; }
}
class TextualObject {
  shared: number; padding: boolean = false; label: string;
  constructor(label: string, shared: number) { this.label = label; this.shared = shared; }
}
interface ObjectRow { kind: string; numExpected: number; strExpected: string; numeric: NumericObject; textual: TextualObject; shared: number; }
const rows: ObjectRow[] = [
  { numExpected: -0, strExpected: "unused", kind: "number", numeric: new NumericObject(-0, NaN), textual: new TextualObject("unused", 91), shared: NaN },
  { numExpected: 92, strExpected: "", kind: "text", numeric: new NumericObject(92, 93), textual: new TextualObject("", -0), shared: -0 },
  { numExpected: NaN, strExpected: "unused", kind: "number", numeric: new NumericObject(NaN, -0), textual: new TextualObject("unused", 94), shared: -0 },
  { numExpected: 95, strExpected: "tail", kind: "text", numeric: new NumericObject(95, 96), textual: new TextualObject("tail", NaN), shared: NaN }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: NumericObject | TextualObject, expected: ObjectRow): void {
  same(value.shared, expected.shared);
  if (value instanceof NumericObject) { log.push("number"); same(value, expected.numeric); same(value.amount, expected.numExpected); }
  else { log.push("text"); same(value, expected.textual); same(value.label, expected.strExpected); same(value.padding, false); }
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.textual, row);
assert.compareArray(log, ["number", "text", "number", "text"]);
