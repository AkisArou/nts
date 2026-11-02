/*---
description: "An interface component record becomes a returned Date after day normalization."
features: [ts-date-routes, ts-date-route-construction, ts-functions, ts-arrow-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-errors, ts-interfaces]
---*/
// An interface component record becomes a returned Date after day normalization. Node preserves the logged time values, every UTC component and exact ISO text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
interface CivilInput { year: number; month: number; day: number }
type Row = { value: CivilInput; expected: number[]; iso: string | null };
const rows: Row[] = [
  { value: { year: 1970, month: 0, day: 1 }, expected: [0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4], iso: "1970-01-01T00:00:00.000Z" }, { value: { year: 1969, month: 11, day: 31 }, expected: [-86400000, -86400000, -86400000, 1969, 11, 31, 0, 0, 0, 0, 3], iso: "1969-12-31T00:00:00.000Z" }, { value: { year: 2000, month: 1, day: 29 }, expected: [951782400000, 951782400000, 951782400000, 2000, 1, 29, 0, 0, 0, 0, 2], iso: "2000-02-29T00:00:00.000Z" },
  { value: { year: 1900, month: 1, day: 29 }, expected: [-2203891200000, -2203891200000, -2203891200000, 1900, 2, 1, 0, 0, 0, 0, 4], iso: "1900-03-01T00:00:00.000Z" }, { value: { year: 2000, month: 1, day: 30 }, expected: [951868800000, 951868800000, 951868800000, 2000, 2, 1, 0, 0, 0, 0, 3], iso: "2000-03-01T00:00:00.000Z" }, { value: { year: 2004, month: 2, day: 0 }, expected: [1078012800000, 1078012800000, 1078012800000, 2004, 1, 29, 0, 0, 0, 0, 0], iso: "2004-02-29T00:00:00.000Z" },
  { value: { year: 2100, month: 1, day: 29 }, expected: [4107542400000, 4107542400000, 4107542400000, 2100, 2, 1, 0, 0, 0, 0, 1], iso: "2100-03-01T00:00:00.000Z" }, { value: { year: 2400, month: 1, day: 29 }, expected: [13574563200000, 13574563200000, 13574563200000, 2400, 1, 29, 0, 0, 0, 0, 2], iso: "2400-02-29T00:00:00.000Z" }, { value: { year: 1999, month: 11, day: 32 }, expected: [946684800000, 946684800000, 946684800000, 2000, 0, 1, 0, 0, 0, 0, 6], iso: "2000-01-01T00:00:00.000Z" },
  { value: { year: 2000, month: 0, day: 0 }, expected: [946598400000, 946598400000, 946598400000, 1999, 11, 31, 0, 0, 0, 0, 5], iso: "1999-12-31T00:00:00.000Z" }, { value: { year: 2000, month: 0, day: -32 }, expected: [943833600000, 943833600000, 943833600000, 1999, 10, 29, 0, 0, 0, 0, 1], iso: "1999-11-29T00:00:00.000Z" }, { value: { year: 2000, month: 0, day: 366 }, expected: [978220800000, 978220800000, 978220800000, 2000, 11, 31, 0, 0, 0, 0, 0], iso: "2000-12-31T00:00:00.000Z" },
  { value: { year: -1, month: 0, day: 1 }, expected: [-62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5], iso: "-000001-01-01T00:00:00.000Z" }, { value: { year: 0, month: 0, day: 1 }, expected: [-2208988800000, -2208988800000, -2208988800000, 1900, 0, 1, 0, 0, 0, 0, 1], iso: "1900-01-01T00:00:00.000Z" }, { value: { year: 9999, month: 11, day: 32 }, expected: [253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6], iso: "+010000-01-01T00:00:00.000Z" },
  { value: { year: 10000, month: 0, day: 0 }, expected: [253402214400000, 253402214400000, 253402214400000, 9999, 11, 31, 0, 0, 0, 0, 5], iso: "9999-12-31T00:00:00.000Z" }, { value: { year: 275760, month: 8, day: 13 }, expected: [8640000000000000, 8640000000000000, 8640000000000000, 275760, 8, 13, 0, 0, 0, 0, 6], iso: "+275760-09-13T00:00:00.000Z" }, { value: { year: 275760, month: 8, day: 14 }, expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null },
  { value: { year: -271821, month: 3, day: 20 }, expected: [-8640000000000000, -8640000000000000, -8640000000000000, -271821, 3, 20, 0, 0, 0, 0, 2], iso: "-271821-04-20T00:00:00.000Z" }, { value: { year: -271821, month: 3, day: 19 }, expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null }, { value: { year: 2000, month: 1, day: 29.9 }, expected: [951782400000, 951782400000, 951782400000, 2000, 1, 29, 0, 0, 0, 0, 2], iso: "2000-02-29T00:00:00.000Z" },
  { value: { year: 2000, month: 1, day: NaN }, expected: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], iso: null }
];
function build(value: CivilInput): Date { return new Date(Date.UTC(value.year, value.month, value.day)); }
for (const row of rows) {
  const date: Date = build(row.value), time = date.getTime();
  const log: unknown[] = [time, date.getTime(), date.valueOf(), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(), date.getUTCDay()];
  if (row.iso === null) assert.throws(RangeError, () => { date.toISOString(); }); else assert.sameValue(date.toISOString(), row.iso);
  exact(log, row.expected);
}
