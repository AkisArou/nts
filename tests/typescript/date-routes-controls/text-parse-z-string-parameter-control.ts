/*---
description: "Control for text-parse-z-string-parameter; A declared ISO string parameter returns exact UTC milliseconds, including expanded years and invalid ranges."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases]
---*/
// ISO input text crosses one typed parsing route; node returns finite milliseconds or NaN without consulting local time. The control computes from plain numbers and Gregorian arithmetic.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return !Number.isFinite(time) || Math.abs(time) > 8640000000000000 ? NaN : Math.trunc(time) + 0; }
function civil(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  for (const value of [year, month, day, hour, minute, second, ms]) if (!Number.isFinite(value)) return NaN; const y = Math.trunc(year) + Math.floor(Math.trunc(month) / 12), m = ((Math.trunc(month) % 12) + 12) % 12, leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0), starts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const days = 365 * (y - 1970) + Math.floor((y - 1) / 4) - Math.floor((y - 1) / 100) + Math.floor((y - 1) / 400) - 477 + starts[m] + (leap && m > 1 ? 1 : 0) + Math.trunc(day) - 1; return days * 86400000 + Math.trunc(hour) * 3600000 + Math.trunc(minute) * 60000 + Math.trunc(second) * 1000 + Math.trunc(ms);
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
type TextRow = { input: string; time: number };
const rows: TextRow[] = [
  { input: "1970-01-01T00:00:00.000Z", time: 0 }, { input: "1969-12-31T23:59:59.999Z", time: -1 },
  { input: "2000-02-29T12:34:56.789Z", time: 951827696789 }, { input: "2020-12-31T23:59:59.999Z", time: 1609459199999 },
  { input: "0000-01-01T00:00:00.000Z", time: -62167219200000 }, { input: "-000001-01-01T00:00:00.000Z", time: -62198755200000 },
  { input: "9999-12-31T23:59:59.999Z", time: 253402300799999 }, { input: "+010000-01-01T00:00:00.000Z", time: 253402300800000 },
  { input: "-271821-04-20T00:00:00.000Z", time: -8640000000000000 }, { input: "+275760-09-13T00:00:00.000Z", time: 8640000000000000 },
  { input: "1970-01-01T00:00:00Z", time: 0 }, { input: "1969-12-31T24:00:00.000Z", time: 0 },
  { input: "1970-01-01T00:00:00.001Z", time: 1 }, { input: "1970-01-01T00:00:00.010Z", time: 10 },
  { input: "1970-13-01T00:00:00.000Z", time: NaN }, { input: "1970-01-01T24:01:00.000Z", time: NaN },
  { input: "+275760-09-13T00:00:00.001Z", time: NaN }, { input: "-271821-04-19T23:59:59.999Z", time: NaN }
];
for (const row of rows) {
  const log: unknown[] = ["input", row.input], time = parseISO(row.input);
  log.push("parsed", time, "after", row.input); exact(log, ["input", row.input, "parsed", row.time, "after", row.input]);
}
