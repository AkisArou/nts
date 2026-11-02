/*---
description: "Numeric parameters carry mixed positive and negative months into UTC years."
features: [ts-date-routes, ts-date-route-construction, ts-functions, ts-arrow-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-errors]
---*/
// Numeric parameters carry mixed positive and negative months into UTC years. Node preserves the logged time values, every UTC component and exact ISO text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Row = { year: number; month: number; expected: number[]; iso: string | null };
const rows: Row[] = [
  { year: 1970, month: 0, expected: [0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4], iso: "1970-01-01T00:00:00.000Z" }, { year: 1969, month: 11, expected: [-2678400000, -2678400000, -2678400000, 1969, 11, 1, 0, 0, 0, 0, 1], iso: "1969-12-01T00:00:00.000Z" }, { year: 2000, month: 1, expected: [949363200000, 949363200000, 949363200000, 2000, 1, 1, 0, 0, 0, 0, 2], iso: "2000-02-01T00:00:00.000Z" },
  { year: 1999, month: 12, expected: [946684800000, 946684800000, 946684800000, 2000, 0, 1, 0, 0, 0, 0, 6], iso: "2000-01-01T00:00:00.000Z" }, { year: 1970, month: 12, expected: [31536000000, 31536000000, 31536000000, 1971, 0, 1, 0, 0, 0, 0, 5], iso: "1971-01-01T00:00:00.000Z" }, { year: 1970, month: -1, expected: [-2678400000, -2678400000, -2678400000, 1969, 11, 1, 0, 0, 0, 0, 1], iso: "1969-12-01T00:00:00.000Z" },
  { year: 2000, month: 25, expected: [1012521600000, 1012521600000, 1012521600000, 2002, 1, 1, 0, 0, 0, 0, 5], iso: "2002-02-01T00:00:00.000Z" }, { year: 2000, month: -14, expected: [909878400000, 909878400000, 909878400000, 1998, 10, 1, 0, 0, 0, 0, 0], iso: "1998-11-01T00:00:00.000Z" }, { year: 100, month: -1200, expected: [-62167219200000, -62167219200000, -62167219200000, 0, 0, 1, 0, 0, 0, 0, 6], iso: "0000-01-01T00:00:00.000Z" },
  { year: 100, month: -1212, expected: [-62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5], iso: "-000001-01-01T00:00:00.000Z" }, { year: 0, month: 0, expected: [-2208988800000, -2208988800000, -2208988800000, 1900, 0, 1, 0, 0, 0, 0, 1], iso: "1900-01-01T00:00:00.000Z" }, { year: 99, month: 12, expected: [946684800000, 946684800000, 946684800000, 2000, 0, 1, 0, 0, 0, 0, 6], iso: "2000-01-01T00:00:00.000Z" },
  { year: 9999, month: 12, expected: [253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6], iso: "+010000-01-01T00:00:00.000Z" }, { year: 10000, month: -1, expected: [253399622400000, 253399622400000, 253399622400000, 9999, 11, 1, 0, 0, 0, 0, 3], iso: "9999-12-01T00:00:00.000Z" }, { year: 275760, month: 8, expected: [8639998963200000, 8639998963200000, 8639998963200000, 275760, 8, 1, 0, 0, 0, 0, 1], iso: "+275760-09-01T00:00:00.000Z" },
  { year: -271821, month: 4, expected: [-8639999049600000, -8639999049600000, -8639999049600000, -271821, 4, 1, 0, 0, 0, 0, 6], iso: "-271821-05-01T00:00:00.000Z" }, { year: 1970, month: 0.9, expected: [0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4], iso: "1970-01-01T00:00:00.000Z" }, { year: 1970, month: -0.9, expected: [0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4], iso: "1970-01-01T00:00:00.000Z" },
  { year: 1970, month: NaN, expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null }, { year: 1970, month: Infinity, expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null }
];
function build(year: number, month: number): number { return Date.UTC(year, month, 1); }
for (const row of rows) {
  const time = build(row.year, row.month), date: Date = new Date(time);
  const log: unknown[] = [time, date.getTime(), date.valueOf(), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(), date.getUTCDay()];
  if (row.iso === null) assert.throws(RangeError, () => { date.toISOString(); }); else assert.sameValue(date.toISOString(), row.iso);
  exact(log, row.expected);
}
