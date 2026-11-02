/*---
description: "A position-indexed string or error table preserves the typed route: typed receiver and radix accessors preserve evaluation order when the radix getter changes the receiver backing value."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-interfaces, ts-type-aliases, ts-objects, ts-accessors, ts-closures, ts-unions, ts-null-undefined, ts-errors, ts-narrowing, ts-instanceof, ts-arrow-functions]
---*/
// Interface accessors log receiver then radix and its write; Node formats the captured old number or throws after both getters, retaining the new backing value.
// Control: retain the typed route and observations; replace only formatting with the indexed table or RangeError sentinel.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
interface FormatSource { get value(): number; get radix(): number }
type FormatRow = { input: number; radix: number; after: number; text: string | null };
const rows: FormatRow[] = [
  { input: 255, radix: 16, after: 0, text: "ff" }, { input: -35, radix: 36, after: 1, text: "-z" },
  { input: -0, radix: 2, after: 42, text: "0" }, { input: NaN, radix: 10, after: 7, text: "NaN" },
  { input: Infinity, radix: 36, after: -1, text: "Infinity" }, { input: 1e21, radix: 32, after: 0, text: "r3biddonfa0000" },
  { input: Number.MIN_VALUE, radix: 1, after: 0, text: null }, { input: Number.MAX_VALUE, radix: 37, after: 1, text: null },
  { input: NaN, radix: 0, after: 5, text: null }, { input: 255, radix: 16.9, after: 2, text: "ff" },
];
function requested(source: FormatSource, position: number): number { const radix = source.radix; same(radix, rows[position].radix); return radix; }
const replacement: (string | null)[] = ["ff","-z","0","NaN","Infinity","r3biddonfa0000",null,null,null,"ff"];
function route(source: FormatSource, position: number, log: unknown[]): string {
  const input: number = source.value; same(input, rows[position].input); const radix: number = requested(source, position); same(radix, rows[position].radix);
  const text = replacement[position]; if (text === null) throw new RangeError(); log.push("text", text); return text;
}
let position = 0;
for (const row of rows) {
  let stored = row.input; const log: unknown[] = [];
  const source: FormatSource = { get value(): number { log.push("value", stored); return stored; }, get radix(): number { log.push("radix", row.radix); stored = row.after; log.push("changed", stored); return row.radix; } };
  if (row.text === null) {
    let caught = false; assert.throws(RangeError, () => { try { route(source, position, log); } catch (error: unknown) { assert.sameValue(error instanceof RangeError, true); caught = true; log.push("RangeError"); throw error; } });
    same(caught, true); exact(log, ["value", row.input, "radix", row.radix, "changed", row.after, "RangeError"]);
  } else { const text = route(source, position, log); same(text, row.text); exact(log, ["value", row.input, "radix", row.radix, "changed", row.after, "text", row.text]); }
  same(stored, row.after); position++;
}
same(position, rows.length);
