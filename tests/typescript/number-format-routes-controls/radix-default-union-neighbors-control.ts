/*---
description: "A position-indexed string or error table preserves the typed route: a narrowed number or record union feeds default toString with unique neighboring binary64 values."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-type-aliases, ts-unions, ts-narrowing, ts-objects]
---*/
// A number-or-record union logs its narrowed payload and default text; Node preserves the listed integer neighbors and omits the sign of zero.
// Control: retain the typed route and observations; replace only formatting with the indexed table or RangeError sentinel.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type FormatInput = number | { value: number };
type FormatRow = { input: FormatInput; raw: number; kind: string; text: string };
const rows: FormatRow[] = [
  { input: 0, raw: 0, kind: "number", text: "0" }, { input: { value: -0 }, raw: -0, kind: "field", text: "0" },
  { input: 0.5, raw: 0.5, kind: "number", text: "0.5" }, { input: { value: -0.5 }, raw: -0.5, kind: "field", text: "-0.5" },
  { input: 0.9999999999999999, raw: 0.9999999999999999, kind: "number", text: "0.9999999999999999" }, { input: { value: 1 }, raw: 1, kind: "field", text: "1" },
  { input: 4503599627370496, raw: 4503599627370496, kind: "number", text: "4503599627370496" }, { input: { value: 4503599627370497 }, raw: 4503599627370497, kind: "field", text: "4503599627370497" },
  { input: 9007199254740991, raw: 9007199254740991, kind: "number", text: "9007199254740991" }, { input: { value: 9007199254740994 }, raw: 9007199254740994, kind: "field", text: "9007199254740994" },
  { input: -9007199254740994, raw: -9007199254740994, kind: "number", text: "-9007199254740994" }, { input: { value: 2147483648 }, raw: 2147483648, kind: "field", text: "2147483648" },
  { input: 4294967297, raw: 4294967297, kind: "number", text: "4294967297" }, { input: { value: NaN }, raw: NaN, kind: "field", text: "NaN" },
  { input: Infinity, raw: Infinity, kind: "number", text: "Infinity" }, { input: { value: -Infinity }, raw: -Infinity, kind: "field", text: "-Infinity" },
];
const replacement: string[] = ["0","0","0.5","-0.5","0.9999999999999999","1","4503599627370496","4503599627370497","9007199254740991","9007199254740994","-9007199254740994","2147483648","4294967297","NaN","Infinity","-Infinity"];
function route(source: FormatInput, position: number, log: unknown[]): string {
  same(source, rows[position].input); let input: number;
  if (typeof source === "number") { input = source; log.push("number", input); }
  else { input = source.value; log.push("field", input); }
  same(input, rows[position].raw); const text: string = replacement[position]; log.push("text", text); return text;
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], original = row.input; const text = route(row.input, position, log);
  same(text, row.text); same(row.input, original); exact(log, [row.kind, row.raw, "text", row.text]); position++;
}
same(position, rows.length);
