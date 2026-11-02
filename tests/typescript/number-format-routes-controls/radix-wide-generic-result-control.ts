/*---
description: "A position-indexed string or error table preserves the typed route: a constrained generic returns its original numeric carrier and exact wide integer text."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-interfaces, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints]
---*/
// A constrained generic logs an integer field and power-of-two radix; Node returns the listed positional digits through ±MAX_VALUE and retains carrier identity.
// Control: retain the typed route and observations; replace only formatting with the indexed table or RangeError sentinel.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
interface FormatSource { value: number; radix: number }
type FormatRow = { input: number; radix: number; text: string };
const rows: FormatRow[] = [
  { input: 9007199254740991, radix: 2, text: "11111111111111111111111111111111111111111111111111111" },
  { input: 9007199254740992, radix: 4, text: "200000000000000000000000000" },
  { input: 9007199254740994, radix: 8, text: "400000000000000002" },
  { input: -9007199254740994, radix: 16, text: "-20000000000002" },
  { input: 1e21, radix: 2, text: "1101100011010111001001101011011100010111011110101000000000000000000000" },
  { input: 1e21, radix: 4, text: "31203113021223130113132220000000000" },
  { input: 1e21, radix: 8, text: "154327115334273650000000" },
  { input: 1e21, radix: 16, text: "3635c9adc5dea00000" },
  { input: 1e21, radix: 32, text: "r3biddonfa0000" },
  { input: Number.MAX_VALUE, radix: 32, text: "fvvvvvvvvvu00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" },
  { input: -1.7976931348623157e308, radix: 32, text: "-fvvvvvvvvvu00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" },
];
const replacement: string[] = ["11111111111111111111111111111111111111111111111111111","200000000000000000000000000","400000000000000002","-20000000000002","1101100011010111001001101011011100010111011110101000000000000000000000","31203113021223130113132220000000000","154327115334273650000000","3635c9adc5dea00000","r3biddonfa0000","fvvvvvvvvvu00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","-fvvvvvvvvvu00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"];
function route<T extends FormatSource>(source: T, position: number, log: unknown[]): { source: T; text: string } {
  const input = source.value, radix = source.radix; same(input, rows[position].input); same(radix, rows[position].radix); log.push("input", input, radix);
  const text: string = replacement[position]; log.push("text", text); return { source, text };
}
let position = 0;
for (const row of rows) {
  const source = { value: row.input, radix: row.radix, label: "wide" }, log: unknown[] = [], result = route(source, position, log);
  same(result.source, source); same(result.source.label, "wide"); same(result.source.value, row.input); same(result.source.radix, row.radix); same(result.text, row.text);
  exact(log, ["input", row.input, row.radix, "text", row.text]); position++;
}
same(position, rows.length);
