/*---
description: "An interface component record becomes a returned Date after day normalization. Numeric control."
features: [ts-date-routes, ts-date-route-construction, ts-functions, ts-arrow-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-errors, ts-spread]
---*/
// The same inputs use inline Gregorian carries, TimeClip and ISO formatting, with no Date object or API.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function civil(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  for (const part of [year, month, day, hour, minute, second, ms]) if (!Number.isFinite(part)) return NaN;
  year = Math.trunc(year); month = Math.trunc(month); year += Math.floor(month / 12); month = (month % 12 + 12) % 12;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0), starts = [0,31,59,90,120,151,181,212,243,273,304,334];
  const days = 365 * (year - 1970) + Math.floor((year - 1) / 4) - Math.floor((year - 1) / 100) + Math.floor((year - 1) / 400) - 477 + starts[month] + (leap && month > 1 ? 1 : 0) + Math.trunc(day) - 1;
  return days * 86400000 + Math.trunc(hour) * 3600000 + Math.trunc(minute) * 60000 + Math.trunc(second) * 1000 + Math.trunc(ms);
}
function parts(time: number): number[] {
  if (!Number.isFinite(time)) return [NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN];
  const day = Math.floor(time / 86400000); let low = -300000, high = 300001;
  while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (civil(middle, 0, 1) / 86400000 <= day) low = middle; else high = middle; }
  let month = 0; while (month < 11 && civil(low, month + 1, 1) / 86400000 <= day) month++;
  const clock = time - day * 86400000; return [low, month, day - civil(low, month, 1) / 86400000 + 1, Math.floor(clock / 3600000), Math.floor(clock / 60000) % 60, Math.floor(clock / 1000) % 60, clock % 1000, ((day + 4) % 7 + 7) % 7];
}
function iso(time: number): string {
  if (!Number.isFinite(time)) throw new RangeError(); const p = parts(time), pad = (n: number, width: number): string => String(n).padStart(width, "0"), year = p[0] >= 0 && p[0] <= 9999 ? pad(p[0], 4) : (p[0] < 0 ? "-" : "+") + pad(Math.abs(p[0]), 6);
  return year + "-" + pad(p[1] + 1, 2) + "-" + pad(p[2], 2) + "T" + pad(p[3], 2) + ":" + pad(p[4], 2) + ":" + pad(p[5], 2) + "." + pad(p[6], 3) + "Z";
}
function utc(year: number, month = 0, day = 1, hour = 0, minute = 0, second = 0, ms = 0): number { year = Math.trunc(year); return clip(civil(year >= 0 && year <= 99 ? year + 1900 : year, month, day, hour, minute, second, ms)); }
type Row = { value: { year: number; month: number; day: number }; expected: number[]; iso: string | null };
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
for (const row of rows) {
  const time = utc(row.value.year, row.value.month, row.value.day);
  const log: unknown[] = [time, time, time, ...parts(time)];
  if (row.iso === null) assert.throws(RangeError, () => { iso(time); }); else assert.sameValue(iso(time), row.iso);
  exact(log, row.expected);
}
