/*---
description: "Explicit construction control: A primitive union crosses typed returns inside nested substitutions before its final string is retained."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-conversions]
---*/
// Typed primitive returns log first, inner, inner-last and last; Node builds the A/BI/J/C/D text in that order and formats negative zero as 0. Control: use explicit strings and ordinary calls with frozen, reused arrays for each site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type NestInput = number | string | boolean | null | undefined | bigint;
const rows: { input: NestInput; text: string }[] = [
  { input: 0, text: "0" }, { input: -0, text: "0" }, { input: NaN, text: "NaN" },
  { input: Infinity, text: "Infinity" }, { input: -Infinity, text: "-Infinity" }, { input: "", text: "" },
  { input: "abc", text: "abc" }, { input: "\u00e9", text: "\u00e9" }, { input: "\ud83d\ude42", text: "\ud83d\ude42" },
  { input: "\ud800", text: "\ud800" }, { input: true, text: "true" }, { input: false, text: "false" },
  { input: null, text: "null" }, { input: undefined, text: "undefined" }, { input: 17n, text: "17" },
];
const log: unknown[] = [], retained: string[] = [];
function read(label: string, value: NestInput): NestInput { log.push(label, value); return value; }
function render(value: NestInput): string {
  return "A" + String(read("first", value)) + "B" + ("I" + String(read("inner", value)) + "J" + String(read("inner-last", value))) + "C" + String(read("last", value)) + "D";
}
for (const row of rows) {
  log.length = 0; const result: string = render(row.input), expected = "A" + row.text + "BI" + row.text + "J" + row.text + "C" + row.text + "D";
  same(result, expected); same(result.length, expected.length); retained.push(result);
  exact(log, ["first", row.input, "inner", row.input, "inner-last", row.input, "last", row.input]);
}
same(retained.length, rows.length);
for (let i = 0; i < rows.length; i++) same(retained[i], "A" + rows[i].text + "BI" + rows[i].text + "J" + rows[i].text + "C" + rows[i].text + "D");
