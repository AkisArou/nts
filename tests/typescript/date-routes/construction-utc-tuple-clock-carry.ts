/*---
description: "A seven-number tuple carries UTC clocks and separately truncated components."
features: [ts-date-routes, ts-date-route-construction, ts-functions, ts-arrow-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-errors, ts-tuples]
---*/
// A seven-number tuple carries UTC clocks and separately truncated components. Node preserves the logged time values, every UTC component and exact ISO text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Components = [number, number, number, number, number, number, number];
type Row = { value: Components; expected: number[]; iso: string | null };
const rows: Row[] = [
  { value: [1970, 0, 1, 0, 0, 0, 0], expected: [0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4], iso: "1970-01-01T00:00:00.000Z" }, { value: [1969, 11, 31, 23, 59, 59, 999], expected: [-1, -1, -1, 1969, 11, 31, 23, 59, 59, 999, 3], iso: "1969-12-31T23:59:59.999Z" }, { value: [2000, 1, 29, 12, 34, 56, 789], expected: [951827696789, 951827696789, 951827696789, 2000, 1, 29, 12, 34, 56, 789, 2], iso: "2000-02-29T12:34:56.789Z" },
  { value: [1999, 11, 31, 23, 59, 59, 1000], expected: [946684800000, 946684800000, 946684800000, 2000, 0, 1, 0, 0, 0, 0, 6], iso: "2000-01-01T00:00:00.000Z" }, { value: [1970, 0, 1, -1, 0, 0, 0], expected: [-3600000, -3600000, -3600000, 1969, 11, 31, 23, 0, 0, 0, 3], iso: "1969-12-31T23:00:00.000Z" }, { value: [1970, 0, 1, 24, 0, 0, 0], expected: [86400000, 86400000, 86400000, 1970, 0, 2, 0, 0, 0, 0, 5], iso: "1970-01-02T00:00:00.000Z" },
  { value: [2000, 1, 29, 48, 0, 0, 0], expected: [951955200000, 951955200000, 951955200000, 2000, 2, 2, 0, 0, 0, 0, 4], iso: "2000-03-02T00:00:00.000Z" }, { value: [1970, 0, 1, 0, -1, 0, 0], expected: [-60000, -60000, -60000, 1969, 11, 31, 23, 59, 0, 0, 3], iso: "1969-12-31T23:59:00.000Z" }, { value: [1970, 0, 1, 0, 0, 60, 0], expected: [60000, 60000, 60000, 1970, 0, 1, 0, 1, 0, 0, 4], iso: "1970-01-01T00:01:00.000Z" },
  { value: [1970, 0, 1, 0, 0, 0, -1], expected: [-1, -1, -1, 1969, 11, 31, 23, 59, 59, 999, 3], iso: "1969-12-31T23:59:59.999Z" }, { value: [1970, 0, 1, 0, 0, 0, 1001], expected: [1001, 1001, 1001, 1970, 0, 1, 0, 0, 1, 1, 4], iso: "1970-01-01T00:00:01.001Z" }, { value: [2000.9, 1.9, 29.9, 12.9, 34.9, 56.9, 789.9], expected: [951827696789, 951827696789, 951827696789, 2000, 1, 29, 12, 34, 56, 789, 2], iso: "2000-02-29T12:34:56.789Z" },
  { value: [-1, 0, 1, 0, 0, 0, 0], expected: [-62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5], iso: "-000001-01-01T00:00:00.000Z" }, { value: [9999, 11, 31, 23, 59, 59, 1000], expected: [253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6], iso: "+010000-01-01T00:00:00.000Z" }, { value: [10000, 0, 1, 0, 0, 0, -1], expected: [253402300799999, 253402300799999, 253402300799999, 9999, 11, 31, 23, 59, 59, 999, 5], iso: "9999-12-31T23:59:59.999Z" },
  { value: [275760, 8, 13, 0, 0, 0, 0], expected: [8640000000000000, 8640000000000000, 8640000000000000, 275760, 8, 13, 0, 0, 0, 0, 6], iso: "+275760-09-13T00:00:00.000Z" }, { value: [275760, 8, 13, 0, 0, 0, 1], expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null }, { value: [-271821, 3, 20, 0, 0, 0, 0], expected: [-8640000000000000, -8640000000000000, -8640000000000000, -271821, 3, 20, 0, 0, 0, 0, 2], iso: "-271821-04-20T00:00:00.000Z" },
  { value: [-271821, 3, 20, 0, 0, 0, -1], expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null }
];
function build(value: Components): number { return Date.UTC(value[0], value[1], value[2], value[3], value[4], value[5], value[6]); }
for (const row of rows) {
  const time = build(row.value), date: Date = new Date(time);
  const log: unknown[] = [time, date.getTime(), date.valueOf(), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(), date.getUTCDay()];
  if (row.iso === null) assert.throws(RangeError, () => { date.toISOString(); }); else assert.sameValue(date.toISOString(), row.iso);
  exact(log, row.expected);
}
