/*---
description: "A literal-year union selects negative, fractional, two-digit and expanded construction years."
features: [ts-date-routes, ts-date-route-construction, ts-functions, ts-arrow-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-errors, ts-unions, ts-literal-types, ts-indexed-access]
---*/
// A literal-year union selects negative, fractional, two-digit and expanded construction years. Node preserves the logged time values, every UTC component and exact ISO text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Row = { year: -1 | -0.9 | 0 | 0.9 | 1 | 49 | 99 | 99.9 | 100 | 9999 | 10000; expected: number[]; iso: string | null };
const rows: Row[] = [
  { year: -1, expected: [-62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5], iso: "-000001-01-01T00:00:00.000Z" },
  { year: -0.9, expected: [-2208988800000, -2208988800000, -2208988800000, 1900, 0, 1, 0, 0, 0, 0, 1], iso: "1900-01-01T00:00:00.000Z" },
  { year: -0, expected: [-2208988800000, -2208988800000, -2208988800000, 1900, 0, 1, 0, 0, 0, 0, 1], iso: "1900-01-01T00:00:00.000Z" },
  { year: 0, expected: [-2208988800000, -2208988800000, -2208988800000, 1900, 0, 1, 0, 0, 0, 0, 1], iso: "1900-01-01T00:00:00.000Z" },
  { year: 0.9, expected: [-2208988800000, -2208988800000, -2208988800000, 1900, 0, 1, 0, 0, 0, 0, 1], iso: "1900-01-01T00:00:00.000Z" },
  { year: 1, expected: [-2177452800000, -2177452800000, -2177452800000, 1901, 0, 1, 0, 0, 0, 0, 2], iso: "1901-01-01T00:00:00.000Z" },
  { year: 49, expected: [-662688000000, -662688000000, -662688000000, 1949, 0, 1, 0, 0, 0, 0, 6], iso: "1949-01-01T00:00:00.000Z" },
  { year: 99, expected: [915148800000, 915148800000, 915148800000, 1999, 0, 1, 0, 0, 0, 0, 5], iso: "1999-01-01T00:00:00.000Z" },
  { year: 99.9, expected: [915148800000, 915148800000, 915148800000, 1999, 0, 1, 0, 0, 0, 0, 5], iso: "1999-01-01T00:00:00.000Z" },
  { year: 100, expected: [-59011459200000, -59011459200000, -59011459200000, 100, 0, 1, 0, 0, 0, 0, 5], iso: "0100-01-01T00:00:00.000Z" },
  { year: 9999, expected: [253370764800000, 253370764800000, 253370764800000, 9999, 0, 1, 0, 0, 0, 0, 5], iso: "9999-01-01T00:00:00.000Z" },
  { year: 10000, expected: [253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6], iso: "+010000-01-01T00:00:00.000Z" }
];
function build(year: Row["year"]): number { return Date.UTC(year, 0, 1); }
for (const row of rows) {
  const time = build(row.year), date: Date = new Date(time);
  const log: unknown[] = [time, date.getTime(), date.valueOf(), date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(), date.getUTCDay()];
  if (row.iso === null) assert.throws(RangeError, () => { date.toISOString(); }); else assert.sameValue(date.toISOString(), row.iso);
  exact(log, row.expected);
}
