/*---
description: Control for objects-class-shared-field; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-class, ts-class-fields, ts-interfaces, ts-numbers, ts-strings]
---*/
// Use separate concrete class references in a kind record; select the concrete shared field by kind before the same common-field and member checks.
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
function inspect(value: ObjectRow, expected: ObjectRow): void {
  const shared = value.kind === "number" ? value.numeric.shared : value.textual.shared;
  same(shared, expected.shared);
  if (value.kind === "number") { log.push("number"); same(value.numeric, expected.numeric); same(value.numeric.amount, expected.numExpected); }
  else { log.push("text"); same(value.textual, expected.textual); same(value.textual.label, expected.strExpected); same(value.textual.padding, false); }
}
for (const row of rows) inspect({ kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual, shared: row.shared }, row);
assert.compareArray(log, ["number", "text", "number", "text"]);
