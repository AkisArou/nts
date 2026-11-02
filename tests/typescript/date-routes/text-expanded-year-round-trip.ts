/*---
description: "A string-or-number interface route returns a Date whose expanded ISO year survives a parse round trip."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-unions, ts-null-undefined, ts-errors, ts-arrow-functions, ts-closures]
---*/
// Both union members pass through one returning constructor; signed six-digit input canonicalizes to four digits where possible, while invalid signed years throw.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
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
interface TimeSource { value: string | number }
function construct(source: TimeSource, log: unknown[]): Date { const time = typeof source.value === "string" ? Date.parse(source.value) : source.value; log.push("resolved", time); return new Date(time); }
for (const row of rows) for (const input of [row.numeric, row.source]) {
  const log: unknown[] = ["source", input], value = construct({ value: input }, log); log.push("time", value.getTime());
  const expected: unknown[] = ["source", input, "resolved", row.time, "time", row.time];
  if (row.text === null) { assert.throws(RangeError, () => { value.toISOString(); }); log.push("throw", "RangeError"); expected.push("throw", "RangeError"); }
  else { const text = value.toISOString(), parsed = Date.parse(text); assert.sameValue(text, row.text); log.push("iso", text, "parsed", parsed); expected.push("iso", row.text, "parsed", row.time); }
  log.push("after", value.valueOf()); expected.push("after", row.time); exact(log, expected);
}
