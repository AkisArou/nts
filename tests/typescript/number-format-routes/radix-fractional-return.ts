/*---
description: "A typed number return carries fractional radices into truncate-before-range conversion."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-type-aliases, ts-objects, ts-conversions]
---*/
// A numeric return logs the untruncated radix; Node truncates valid positive fractions, including 36.9 to base 36, before formatting.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type FormatRow = { input: number; radix: number; text: string };
const rows: FormatRow[] = [
  { input: 35, radix: 2.9, text: "100011" }, { input: -35, radix: 2.1, text: "-100011" },
  { input: 255, radix: 8.9, text: "377" }, { input: -255, radix: 8.1, text: "-377" },
  { input: 65535, radix: 10.9, text: "65535" }, { input: -65535, radix: 16.9, text: "-ffff" },
  { input: 35, radix: 35.999, text: "10" }, { input: 255, radix: 36.9, text: "73" },
  { input: 0, radix: 36.1, text: "0" }, { input: -0, radix: 2.999, text: "0" },
  { input: NaN, radix: 16.5, text: "NaN" }, { input: Infinity, radix: 3.9, text: "Infinity" },
  { input: -Infinity, radix: 35.5, text: "-Infinity" },
];
function requested(position: number, log: unknown[]): number { const radix: number = rows[position].radix; log.push("return", radix); return radix; }
function route(input: number, position: number, log: unknown[]): string {
  same(input, rows[position].input); log.push("input", input); const radix: number = requested(position, log); same(radix, rows[position].radix);
  const text: string = input.toString(radix); log.push("text", text); return text;
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], text = route(row.input, position, log); same(text, row.text);
  exact(log, ["input", row.input, "return", row.radix, "text", row.text]); position++;
}
same(position, rows.length);
