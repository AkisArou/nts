/*---
description: "A declared ISO string parameter returns exact UTC milliseconds, including expanded years and invalid ranges."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases]
---*/
// ISO input text crosses one typed parsing route; node returns finite milliseconds or NaN without consulting local time.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
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
function parse(text: string): number { return Date.parse(text); }
for (const row of rows) {
  const log: unknown[] = ["input", row.input], time = parse(row.input);
  log.push("parsed", time, "after", row.input); exact(log, ["input", row.input, "parsed", row.time, "after", row.input]);
}
