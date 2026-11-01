/*---
description: Control for objects-class-common-method-result; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-class, ts-class-fields, ts-interfaces, ts-numbers, ts-strings]
---*/
// Choose a concrete receiver field by kind and call its concrete return type, preserving the same method body, value checks and receiver identity.
class NumberReader {
  value: number; constructor(value: number) { this.value = value; }
  read(): number { return this.value; }
}
class TextReader {
  marker: boolean = false; text: string; constructor(text: string) { this.text = text; }
  read(): string { return this.text; }
}
interface ObjectRow { kind: string; numExpected: number; strExpected: string; numeric: NumberReader; textual: TextReader; }
const rows: ObjectRow[] = [
  { numExpected: -0, strExpected: "unused", kind: "number", numeric: new NumberReader(-0), textual: new TextReader("unused") },
  { numExpected: 91, strExpected: "", kind: "text", numeric: new NumberReader(91), textual: new TextReader("") },
  { numExpected: NaN, strExpected: "unused", kind: "number", numeric: new NumberReader(NaN), textual: new TextReader("unused") },
  { numExpected: 92, strExpected: "tail", kind: "text", numeric: new NumberReader(92), textual: new TextReader("tail") }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: ObjectRow, expected: ObjectRow): void {
  if (value.kind === "number") { const result = value.numeric.read(); log.push("number"); same(value.numeric, expected.numeric); same(result, expected.numExpected); }
  else { const result = value.textual.read(); log.push("text"); same(value.textual, expected.textual); same(result, expected.strExpected); }
}
for (const row of rows) inspect({ kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual }, row);
assert.compareArray(log, ["number", "text", "number", "text"]);
