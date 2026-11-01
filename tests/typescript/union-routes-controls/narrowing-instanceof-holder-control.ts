/*---
description: Control for narrowing-instanceof-holder; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-class, ts-class-fields, ts-interfaces, ts-numbers, ts-strings]
---*/
// Store both concrete class references in a kind record and select its corresponding field instead of testing instanceof.
class NarrowNumber { num: number; constructor(num: number) { this.num = num; } }
class NarrowText { padding: boolean = false; str: string; constructor(str: string) { this.str = str; } }
interface NarrowRow { kind: string; numExpected: number; strExpected: string; numeric: NarrowNumber; textual: NarrowText; }
const rows: NarrowRow[] = [
  { numExpected: -0, strExpected: "unused", kind: "number", numeric: new NarrowNumber(-0), textual: new NarrowText("unused") },
  { numExpected: 81, strExpected: "", kind: "text", numeric: new NarrowNumber(81), textual: new NarrowText("") },
  { numExpected: NaN, strExpected: "unused", kind: "number", numeric: new NarrowNumber(NaN), textual: new NarrowText("unused") },
  { numExpected: 82, strExpected: "tail", kind: "text", numeric: new NarrowNumber(82), textual: new NarrowText("tail") }
];
const log: string[] = [];
interface NarrowHolder { current: NarrowRow; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(holder: NarrowHolder, expected: NarrowRow): void {
  const value = holder.current;
  if (value.kind === "number") { log.push("number"); same(value.numeric, expected.numeric); same(value.numeric.num, expected.numExpected); }
  else { log.push("text"); same(value.textual, expected.textual); same(value.textual.str, expected.strExpected); same(value.textual.padding, false); }
}
for (const row of rows) {
  const holder: NarrowHolder = { current: { kind: row.kind, numExpected: row.numExpected, strExpected: row.strExpected, numeric: row.numeric, textual: row.textual } };
  inspect(holder, row);
}
assert.compareArray(log, ["number", "text", "number", "text"]);
