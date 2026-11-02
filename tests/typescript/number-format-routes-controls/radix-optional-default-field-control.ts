/*---
description: "A position-indexed string or error table preserves the typed route: optional radix fields preserve absence or undefined while selecting default decimal formatting."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-interfaces, ts-type-aliases, ts-objects, ts-optional-properties, ts-null-undefined, ts-unions]
---*/
// An optional interface field logs presence, the number and radix; Node treats absent or undefined radix as ten while preserving source presence.
// Control: retain the typed route and observations; replace only formatting with the indexed table or RangeError sentinel.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
interface FormatSource { value: number; radix?: number }
type FormatRow = { source: FormatSource; own: boolean; raw: number; radix: number | undefined; text: string };
const rows: FormatRow[] = [
  { source: { value: 0 }, own: false, raw: 0, radix: undefined, text: "0" }, { source: { value: -0, radix: undefined }, own: true, raw: -0, radix: undefined, text: "0" },
  { source: { value: 0.5, radix: 10 }, own: true, raw: 0.5, radix: 10, text: "0.5" }, { source: { value: -0.5 }, own: false, raw: -0.5, radix: undefined, text: "-0.5" },
  { source: { value: 1e-7, radix: undefined }, own: true, raw: 1e-7, radix: undefined, text: "1e-7" }, { source: { value: 1e-6, radix: 10 }, own: true, raw: 1e-6, radix: 10, text: "0.000001" },
  { source: { value: 1e21 }, own: false, raw: 1e21, radix: undefined, text: "1e+21" }, { source: { value: 9007199254740994, radix: undefined }, own: true, raw: 9007199254740994, radix: undefined, text: "9007199254740994" },
  { source: { value: NaN, radix: 10 }, own: true, raw: NaN, radix: 10, text: "NaN" }, { source: { value: Infinity }, own: false, raw: Infinity, radix: undefined, text: "Infinity" },
  { source: { value: -Infinity, radix: undefined }, own: true, raw: -Infinity, radix: undefined, text: "-Infinity" },
];
const replacement: string[] = ["0","0","0.5","-0.5","1e-7","0.000001","1e+21","9007199254740994","NaN","Infinity","-Infinity"];
function route(source: FormatSource, position: number, log: unknown[]): string {
  const input = source.value, radix = source.radix; same(input, rows[position].raw); same(radix, rows[position].radix);
  log.push("optional", Object.hasOwn(source, "radix"), input, radix); const text: string = replacement[position]; log.push("text", text); return text;
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], text = route(row.source, position, log); same(text, row.text); same(row.source.value, row.raw);
  same(Object.hasOwn(row.source, "radix"), row.own); same(row.source.radix, row.radix); exact(log, ["optional", row.own, row.raw, row.radix, "text", row.text]); position++;
}
same(position, rows.length);
