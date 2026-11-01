/*---
description: A common method on a class union returns the representation belonging to the reached receiver.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-class, ts-class-fields, ts-interfaces, ts-unions, ts-narrowing, ts-numbers, ts-strings]
---*/
// NumberReader|TextReader dispatches read before narrowing its number|string result; node keeps the reached receiver identity and exact returned payload.
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
function inspect(value: NumberReader | TextReader, expected: ObjectRow): void {
  const result: number | string = value.read();
  if (typeof result === "number") { log.push("number"); same(value, expected.numeric); same(result, expected.numExpected); }
  else { log.push("text"); same(value, expected.textual); same(result, expected.strExpected); }
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.textual, row);
assert.compareArray(log, ["number", "text", "number", "text"]);
