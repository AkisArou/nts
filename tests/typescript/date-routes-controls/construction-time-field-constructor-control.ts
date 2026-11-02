/*---
description: "A readonly numeric field is used to construct a returned Date. Numeric control."
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
for (const row of rows) {
  const time = clip(row.value);
  const log: unknown[] = [time, time, time, ...parts(time)];
  if (row.iso === null) assert.throws(RangeError, () => { iso(time); }); else assert.sameValue(iso(time), row.iso);
  exact(log, row.expected);
}
