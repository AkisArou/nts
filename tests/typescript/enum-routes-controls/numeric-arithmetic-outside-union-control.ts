/*---
description: "Explicit-object control: Enum members and arithmetic numbers outside the enum retain their values and missing reverse entries through an interface union."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-unions, ts-narrowing, ts-tuples, ts-null-undefined, ts-type-aliases, ts-record, ts-literal-types]
---*/
// Ordinal or number enters a declared interface field and typed return; node selects member branches only for 1 and 4, and reports undefined reverse names for arithmetic values, NaN and infinity. The control uses frozen forward members and a separate explicit reverse map.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Ordinal = 1 | 4;
const Ordinal = Object.freeze({ Low: 1, High: 4 });
const OrdinalReverse: Readonly<Record<number, string | undefined>> = Object.freeze({ 1: "Low", 4: "High" });
interface Slot { value: Ordinal | number; }
const log: unknown[] = [];
function read(slot: Slot): Ordinal | number { const value = slot.value; if (value === Ordinal.Low) log.push("low", value); else if (value === Ordinal.High) log.push("high", value); else log.push("outside", value); return value; }
const rows: [Ordinal | number, number, string, string | undefined][] = [[Ordinal.Low, 1, "low", "Low"], [Ordinal.High, 4, "high", "High"], [Ordinal.Low + 1, 2, "outside", undefined], [Ordinal.High + 1, 5, "outside", undefined], [Ordinal.Low - 2, -1, "outside", undefined], [NaN, NaN, "outside", undefined], [Infinity, Infinity, "outside", undefined]];
for (const [input, expected, branch, name] of rows) {
  log.length = 0; const slot: Slot = { value: input }; const result: Ordinal | number = read(slot);
  same(result, expected); same(slot.value, expected); same(OrdinalReverse[result], name); exact(log, [branch, expected]);
}
