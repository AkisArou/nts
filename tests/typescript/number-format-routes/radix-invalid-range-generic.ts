/*---
description: "A constrained generic validates invalid radices before zero, nonfinite or extreme receiver formatting."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-interfaces, ts-type-aliases, ts-objects, ts-unions, ts-null-undefined, ts-generics, ts-generic-constraints, ts-errors, ts-narrowing, ts-instanceof, ts-arrow-functions, ts-conversions]
---*/
// A constrained generic logs number and radix; Node throws RangeError for invalid bases even on NaN or infinities, while valid witness rows return text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
interface FormatSource { value: number; radix: number | undefined }
type FormatRow = { input: number; radix: number | undefined; text: string | null };
const rows: FormatRow[] = [
  { input: 1, radix: -Infinity, text: null }, { input: 255, radix: -1, text: null },
  { input: 35, radix: -0, text: null }, { input: 0, radix: 0, text: null },
  { input: -0, radix: 1, text: null }, { input: Number.MIN_VALUE, radix: 1.999, text: null },
  { input: Number.MAX_VALUE, radix: 37, text: null }, { input: NaN, radix: 37.9, text: null },
  { input: Infinity, radix: Infinity, text: null }, { input: -Infinity, radix: NaN, text: null },
  { input: 42, radix: 4294967298, text: null }, { input: 255, radix: 2, text: "11111111" },
  { input: NaN, radix: 36, text: "NaN" }, { input: Infinity, radix: undefined, text: "Infinity" },
  { input: -0, radix: 10, text: "0" }, { input: 35, radix: 36.9, text: "z" },
];
function route<T extends FormatSource>(source: T, position: number, log: unknown[]): string {
  const input = source.value, radix = source.radix; same(input, rows[position].input); same(radix, rows[position].radix); log.push("input", input, radix);
  const text: string = input.toString(radix); log.push("text", text); return text;
}
let position = 0;
for (const row of rows) {
  const source = { value: row.input, radix: row.radix }, log: unknown[] = [];
  if (row.text === null) {
    let caught = false; assert.throws(RangeError, () => { try { route(source, position, log); } catch (error: unknown) { assert.sameValue(error instanceof RangeError, true); caught = true; log.push("RangeError"); throw error; } });
    same(caught, true); exact(log, ["input", row.input, row.radix, "RangeError"]);
  } else { const text = route(source, position, log); same(text, row.text); exact(log, ["input", row.input, row.radix, "text", row.text]); }
  same(source.value, row.input); same(source.radix, row.radix); position++;
}
same(position, rows.length);
