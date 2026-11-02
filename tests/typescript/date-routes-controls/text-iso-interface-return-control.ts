/*---
description: "Control for text-iso-interface-return; An interface-held Date returns canonical UTC ISO text and throws RangeError only for invalid time."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-unions, ts-null-undefined, ts-errors, ts-arrow-functions, ts-closures]
---*/
// The same Date field reaches a string return across all year widths and TimeClip boundaries; node preserves its numeric value before and after formatting. The control computes from plain numbers and Gregorian arithmetic.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return !Number.isFinite(time) || Math.abs(time) > 8640000000000000 ? NaN : Math.trunc(time) + 0; }
function civil(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  for (const value of [year, month, day, hour, minute, second, ms]) if (!Number.isFinite(value)) return NaN; const y = Math.trunc(year) + Math.floor(Math.trunc(month) / 12), m = ((Math.trunc(month) % 12) + 12) % 12, leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0), starts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const days = 365 * (y - 1970) + Math.floor((y - 1) / 4) - Math.floor((y - 1) / 100) + Math.floor((y - 1) / 400) - 477 + starts[m] + (leap && m > 1 ? 1 : 0) + Math.trunc(day) - 1; return days * 86400000 + Math.trunc(hour) * 3600000 + Math.trunc(minute) * 60000 + Math.trunc(second) * 1000 + Math.trunc(ms);
}
function parts(time: number): number[] {
  if (!Number.isFinite(time)) return [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN]; const day = Math.floor(time / 86400000), within = time - day * 86400000; let low = -300000, high = 300001; while (low + 1 < high) { const mid = Math.floor((low + high) / 2); if (civil(mid, 0, 1) <= time) low = mid; else high = mid; }
  let month = 0; while (month < 11 && civil(low, month + 1, 1) <= time) month++; return [low, month, Math.floor((time - civil(low, month, 1)) / 86400000) + 1, Math.floor(within / 3600000), Math.floor(within / 60000) % 60, Math.floor(within / 1000) % 60, within % 1000, ((day + 4) % 7 + 7) % 7];
}
function iso(time: number): string {
  if (!Number.isFinite(time)) throw new RangeError("Invalid time value"); const p = parts(time), year = p[0], y = year >= 0 && year <= 9999 ? String(year).padStart(4, "0") : (year < 0 ? "-" : "+") + String(Math.abs(year)).padStart(6, "0");
  return y + "-" + String(p[1] + 1).padStart(2, "0") + "-" + String(p[2]).padStart(2, "0") + "T" + String(p[3]).padStart(2, "0") + ":" + String(p[4]).padStart(2, "0") + ":" + String(p[5]).padStart(2, "0") + "." + String(p[6]).padStart(3, "0") + "Z";
}
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
for (const row of rows) {
  const time = clip(row.input), log: unknown[] = ["before", time], expected: unknown[] = ["before", row.time];
  if (row.text === null) { assert.throws(RangeError, () => { iso(time); }); log.push("throw", "RangeError"); expected.push("throw", "RangeError"); }
  else { const text = iso(time); log.push("iso", text); expected.push("iso", row.text); assert.sameValue(text, row.text); }
  log.push("after", time); expected.push("after", row.time); exact(log, expected);
}
