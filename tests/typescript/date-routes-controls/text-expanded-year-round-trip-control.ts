/*---
description: "Control for text-expanded-year-round-trip; A string-or-number interface route returns a Date whose expanded ISO year survives a parse round trip."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-unions, ts-null-undefined, ts-errors, ts-arrow-functions, ts-closures]
---*/
// Both union members pass through one returning constructor; signed six-digit input canonicalizes to four digits where possible, while invalid signed years throw. The control computes from plain numbers and Gregorian arithmetic.
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
function digits(text: string, at: number, count: number): number { if (at + count > text.length) return NaN; let value = 0; for (let i = 0; i < count; i++) { const d = text.charCodeAt(at + i) - 48; if (d < 0 || d > 9) return NaN; value = value * 10 + d; } return value; }
function parseISO(text: string): number {
  const signed = text[0] === "+" || text[0] === "-", width = signed ? 7 : 4, year = digits(text, signed ? 1 : 0, signed ? 6 : 4) * (text[0] === "-" ? -1 : 1), month = digits(text, width + 1, 2), day = digits(text, width + 4, 2), hour = digits(text, width + 7, 2), minute = digits(text, width + 10, 2), second = digits(text, width + 13, 2);
  for (const value of [year, month, day, hour, minute, second]) if (!Number.isFinite(value)) return NaN; if (text[width] !== "-" || text[width + 3] !== "-" || text[width + 6] !== "T" || text[width + 9] !== ":" || text[width + 12] !== ":" || signed && text[0] === "-" && year === 0) return NaN;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 59) return NaN; let at = width + 15, ms = 0;
  if (text[at] === ".") { let count = 0; at++; while (at < text.length) { const d = text.charCodeAt(at) - 48; if (d < 0 || d > 9) break; if (count < 3) ms = ms * 10 + d; count++; at++; } if (count === 0) return NaN; if (count === 1) ms *= 100; if (count === 2) ms *= 10; }
  if (hour === 24 && (minute !== 0 || second !== 0 || ms !== 0)) return NaN; let offset = 0;
  if (text[at] === "Z" && at + 1 === text.length) {} else if ((text[at] === "+" || text[at] === "-") && at + 6 === text.length && text[at + 3] === ":") { const h = digits(text, at + 1, 2), m = digits(text, at + 4, 2); if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return NaN; offset = (h * 60 + m) * 60000 * (text[at] === "+" ? 1 : -1); } else return NaN;
  return clip(civil(year, month - 1, day, hour, minute, second, ms) - offset);
}
type TextRow = { numeric: number; source: string; time: number; text: string | null };
const rows: TextRow[] = [
  { numeric: 0, source: "+001970-01-01T00:00:00.000Z", time: 0, text: "1970-01-01T00:00:00.000Z" }, { numeric: 0, source: "+001970-01-01T00:00:00.000Z", time: 0, text: "1970-01-01T00:00:00.000Z" },
  { numeric: -1, source: "+001969-12-31T23:59:59.999Z", time: -1, text: "1969-12-31T23:59:59.999Z" }, { numeric: 951827696789, source: "+002000-02-29T12:34:56.789Z", time: 951827696789, text: "2000-02-29T12:34:56.789Z" },
  { numeric: 1609459199999, source: "+002020-12-31T23:59:59.999Z", time: 1609459199999, text: "2020-12-31T23:59:59.999Z" }, { numeric: -62167219200000, source: "+000000-01-01T00:00:00.000Z", time: -62167219200000, text: "0000-01-01T00:00:00.000Z" },
  { numeric: -62198755200000, source: "-000001-01-01T00:00:00.000Z", time: -62198755200000, text: "-000001-01-01T00:00:00.000Z" }, { numeric: 253402300799999, source: "+009999-12-31T23:59:59.999Z", time: 253402300799999, text: "9999-12-31T23:59:59.999Z" },
  { numeric: 253402300800000, source: "+010000-01-01T00:00:00.000Z", time: 253402300800000, text: "+010000-01-01T00:00:00.000Z" }, { numeric: -8640000000000000, source: "-271821-04-20T00:00:00.000Z", time: -8640000000000000, text: "-271821-04-20T00:00:00.000Z" },
  { numeric: 8640000000000000, source: "+275760-09-13T00:00:00.000Z", time: 8640000000000000, text: "+275760-09-13T00:00:00.000Z" }, { numeric: NaN, source: "-000000-01-01T00:00:00.000Z", time: NaN, text: null },
  { numeric: NaN, source: "+275760-09-13T00:00:00.001Z", time: NaN, text: null }
];
for (const row of rows) for (const input of [row.numeric, row.source]) {
  const log: unknown[] = ["source", input], resolved = typeof input === "string" ? parseISO(input) : input, value = clip(resolved); log.push("resolved", resolved, "time", value);
  const expected: unknown[] = ["source", input, "resolved", row.time, "time", row.time];
  if (row.text === null) { assert.throws(RangeError, () => { iso(value); }); log.push("throw", "RangeError"); expected.push("throw", "RangeError"); }
  else { const text = iso(value), parsed = parseISO(text); assert.sameValue(text, row.text); log.push("iso", text, "parsed", parsed); expected.push("iso", row.text, "parsed", row.time); }
  log.push("after", value); expected.push("after", row.time); exact(log, expected);
}
