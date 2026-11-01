/*---
description: A truthful type predicate selects exact object-union payloads after a typed call.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-narrowing, ts-type-guards, ts-numbers, ts-strings]
---*/
// A truthful in-based predicate narrows NumberMember|TextMember; node logs every guard and selected branch and preserves both object identities and payloads.
interface NumberMember { num: number; shared: { id: number }; }
interface TextMember { str: string; shared: { id: number }; }
interface NarrowRow { kind: string; numExpected: number; strExpected: string; numeric: NumberMember; textual: TextMember; }
const point = { id: 7 };
const rows: NarrowRow[] = [
  { numExpected: -0, strExpected: "unused", kind: "number", numeric: { num: -0, shared: point }, textual: { str: "unused", shared: point } },
  { numExpected: 81, strExpected: "", kind: "text", numeric: { num: 81, shared: point }, textual: { str: "", shared: point } },
  { numExpected: NaN, strExpected: "unused", kind: "number", numeric: { num: NaN, shared: point }, textual: { str: "unused", shared: point } },
  { numExpected: 82, strExpected: "tail", kind: "text", numeric: { num: 82, shared: point }, textual: { str: "tail", shared: point } }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function isNumber(value: NumberMember | TextMember): value is NumberMember {
  const result = "num" in value && typeof value.num === "number"; log.push(result ? "guard:number" : "guard:text"); return result;
}
function inspect(value: NumberMember | TextMember, expected: NarrowRow): void {
  if (isNumber(value)) { log.push("number"); same(value, expected.numeric); same(value.num, expected.numExpected); same(value.shared, point); }
  else { log.push("text"); same(value, expected.textual); same(value.str, expected.strExpected); same(value.shared, point); }
}
for (const row of rows) inspect(row.kind === "number" ? row.numeric : row.textual, row);
assert.compareArray(log, ["guard:number", "number", "guard:text", "text", "guard:number", "number", "guard:text", "text"]);
