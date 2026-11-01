/*---
description: A class union stored in an interface field is narrowed by instanceof to its original object.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-class, ts-class-fields, ts-interfaces, ts-unions, ts-instanceof, ts-narrowing, ts-numbers, ts-strings]
---*/
// NarrowNumber|NarrowText travels in an interface field; instanceof chooses the layout and node preserves the object and exact own-field payload.
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
interface NarrowHolder { current: NarrowNumber | NarrowText; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(holder: NarrowHolder, expected: NarrowRow): void {
  const value = holder.current;
  if (value instanceof NarrowNumber) { log.push("number"); same(value, expected.numeric); same(value.num, expected.numExpected); }
  else { log.push("text"); same(value, expected.textual); same(value.str, expected.strExpected); same(value.padding, false); }
}
for (const row of rows) {
  const holder: NarrowHolder = { current: row.kind === "number" ? row.numeric : row.textual };
  inspect(holder, row);
}
assert.compareArray(log, ["number", "text", "number", "text"]);
