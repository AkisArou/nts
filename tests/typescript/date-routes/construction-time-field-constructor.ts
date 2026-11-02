/*---
description: "A readonly numeric field is used to construct a returned Date."
features: [ts-date-routes, ts-date-route-construction, ts-functions, ts-arrow-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-errors, ts-interfaces, ts-readonly]
---*/
// A readonly numeric field is used to construct a returned Date. Node preserves the logged time values, every UTC component and exact ISO text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
interface TimeInput { readonly value: number }
type Row = { value: number; expected: number[]; iso: string | null };
const rows: Row[] = [
  { value: 0, expected: [0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4], iso: "1970-01-01T00:00:00.000Z" }, { value: -0, expected: [0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4], iso: "1970-01-01T00:00:00.000Z" },
  { value: -1, expected: [-1, -1, -1, 1969, 11, 31, 23, 59, 59, 999, 3], iso: "1969-12-31T23:59:59.999Z" }, { value: 951827696789, expected: [951827696789, 951827696789, 951827696789, 2000, 1, 29, 12, 34, 56, 789, 2], iso: "2000-02-29T12:34:56.789Z" },
  { value: 946684799999, expected: [946684799999, 946684799999, 946684799999, 1999, 11, 31, 23, 59, 59, 999, 5], iso: "1999-12-31T23:59:59.999Z" }, { value: -62167219200000, expected: [-62167219200000, -62167219200000, -62167219200000, 0, 0, 1, 0, 0, 0, 0, 6], iso: "0000-01-01T00:00:00.000Z" },
  { value: -62198755200000, expected: [-62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5], iso: "-000001-01-01T00:00:00.000Z" }, { value: 253402300799999, expected: [253402300799999, 253402300799999, 253402300799999, 9999, 11, 31, 23, 59, 59, 999, 5], iso: "9999-12-31T23:59:59.999Z" },
  { value: 253402300800000, expected: [253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6], iso: "+010000-01-01T00:00:00.000Z" }, { value: -8640000000000000, expected: [-8640000000000000, -8640000000000000, -8640000000000000, -271821, 3, 20, 0, 0, 0, 0, 2], iso: "-271821-04-20T00:00:00.000Z" },
  { value: 8640000000000000, expected: [8640000000000000, 8640000000000000, 8640000000000000, 275760, 8, 13, 0, 0, 0, 0, 6], iso: "+275760-09-13T00:00:00.000Z" }, { value: 8640000000000001, expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null },
  { value: NaN, expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null }
];
function build(input: TimeInput): Date { return new Date(input.value); }
for (const row of rows) {
  const input: TimeInput = { value: row.value }, date: Date = build(input), time = date.getTime();
  const log: unknown[] = [time, date.getTime(), date.valueOf(), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(), date.getUTCDay()];
  if (row.iso === null) assert.throws(RangeError, () => { date.toISOString(); }); else assert.sameValue(date.toISOString(), row.iso);
  exact(log, row.expected);
}
