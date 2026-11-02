/*---
description: "A literal-year union selects negative, fractional, two-digit and expanded construction years. Numeric control."
features: [ts-date-routes, ts-date-route-construction, ts-functions, ts-arrow-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-null-undefined, ts-errors, ts-unions, ts-spread]
---*/
// A literal-year union selects negative, fractional, two-digit and expanded construction years. Node preserves the logged time values, every UTC component and exact ISO text.
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
type Row = { year: number; expected: number[]; iso: string | null };
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
for (const row of rows) {
  const time = utc(row.year, 0, 1);
  const log: unknown[] = [time, time, time, ...parts(time)];
  if (row.iso === null) assert.throws(RangeError, () => { iso(time); }); else assert.sameValue(iso(time), row.iso);
  exact(log, row.expected);
}
