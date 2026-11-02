/*---
description: "A nullable generic Date route returns builtin JSON text for finite time and null for invalid or absent values."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-null-undefined]
---*/
// Valid values, invalid Date objects and the null union member use one consumer; node toJSON returns null without throwing for invalid time.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TextRow = { input: number; time: number; text: string | null };
const rows: TextRow[] = [
  { input: 0, time: 0, text: "1970-01-01T00:00:00.000Z" }, { input: -0.0, time: 0, text: "1970-01-01T00:00:00.000Z" },
  { input: -1, time: -1, text: "1969-12-31T23:59:59.999Z" }, { input: 951827696789, time: 951827696789, text: "2000-02-29T12:34:56.789Z" },
  { input: 1609459199999, time: 1609459199999, text: "2020-12-31T23:59:59.999Z" }, { input: -62167219200000, time: -62167219200000, text: "0000-01-01T00:00:00.000Z" },
  { input: -62198755200000, time: -62198755200000, text: "-000001-01-01T00:00:00.000Z" }, { input: 253402300799999, time: 253402300799999, text: "9999-12-31T23:59:59.999Z" },
  { input: 253402300800000, time: 253402300800000, text: "+010000-01-01T00:00:00.000Z" }, { input: -8640000000000000, time: -8640000000000000, text: "-271821-04-20T00:00:00.000Z" },
  { input: 8640000000000000, time: 8640000000000000, text: "+275760-09-13T00:00:00.000Z" }, { input: 1.9, time: 1, text: "1970-01-01T00:00:00.001Z" },
  { input: -1.9, time: -1, text: "1969-12-31T23:59:59.999Z" }, { input: NaN, time: NaN, text: null },
  { input: Infinity, time: NaN, text: null }, { input: -Infinity, time: NaN, text: null },
  { input: 8640000000000001, time: NaN, text: null }, { input: -8640000000000001, time: NaN, text: null }
];
function render<T extends Date>(value: T | null): string | null { return value === null ? null : value.toJSON(); }
for (const row of rows) for (const absent of [false, true]) {
  const value: Date | null = absent ? null : new Date(row.input), before = value === null ? null : value.getTime(), log: unknown[] = ["before", before];
  const text = render(value); log.push("json", text); assert.sameValue(text, absent ? null : row.text);
  log.push("after", value === null ? null : value.valueOf()); exact(log, ["before", absent ? null : row.time, "json", absent ? null : row.text, "after", absent ? null : row.time]);
}
