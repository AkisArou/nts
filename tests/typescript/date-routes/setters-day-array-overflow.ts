/*---
description: "A Date array element preserves day overflow across months, years and clipping."
features: [ts-date-routes, ts-date-route-setters, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-errors, ts-instanceof, ts-spread, ts-tuples, ts-indexed-access]
---*/
// A declared Date array carries the mutated object; node logs day-zero and overflow normalization with exact caller-visible fields and text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); assert.sameValue(actual, expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function record(value: Date, label: string, result: number, log: unknown[]): void {
  log.push(label, result, value.getTime(), value.valueOf(), value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds(), value.getUTCDay());
  try { log.push("iso", value.toISOString()); } catch (error) { same(error instanceof RangeError, true); log.push("RangeError"); }
  log.push("json", value.toJSON());
}
type InputRow = { time: number; args: [number]; expected: unknown[] };
const rows: InputRow[] = [
  { time: 0, args: [0], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, 0, "after", -86400000, -86400000, -86400000, 1969, 11, 31, 0, 0, 0, 0, 3, "iso", "1969-12-31T00:00:00.000Z", "json", "1969-12-31T00:00:00.000Z"] },
  { time: -1, args: [-1], expected: ["before", -1, -1, -1, 1969, 11, 31, 23, 59, 59, 999, 3, "iso", "1969-12-31T23:59:59.999Z", "json", "1969-12-31T23:59:59.999Z", "call", 1, -1, "after", -2764800001, -2764800001, -2764800001, 1969, 10, 29, 23, 59, 59, 999, 6, "iso", "1969-11-29T23:59:59.999Z", "json", "1969-11-29T23:59:59.999Z"] },
  { time: 951827696789, args: [30.9], expected: ["before", 951827696789, 951827696789, 951827696789, 2000, 1, 29, 12, 34, 56, 789, 2, "iso", "2000-02-29T12:34:56.789Z", "json", "2000-02-29T12:34:56.789Z", "call", 1, 30.9, "after", 951914096789, 951914096789, 951914096789, 2000, 2, 1, 12, 34, 56, 789, 3, "iso", "2000-03-01T12:34:56.789Z", "json", "2000-03-01T12:34:56.789Z"] },
  { time: 946684799999, args: [32], expected: ["before", 946684799999, 946684799999, 946684799999, 1999, 11, 31, 23, 59, 59, 999, 5, "iso", "1999-12-31T23:59:59.999Z", "json", "1999-12-31T23:59:59.999Z", "call", 1, 32, "after", 946771199999, 946771199999, 946771199999, 2000, 0, 1, 23, 59, 59, 999, 6, "iso", "2000-01-01T23:59:59.999Z", "json", "2000-01-01T23:59:59.999Z"] },
  { time: -62167219200000, args: [0], expected: ["before", -62167219200000, -62167219200000, -62167219200000, 0, 0, 1, 0, 0, 0, 0, 6, "iso", "0000-01-01T00:00:00.000Z", "json", "0000-01-01T00:00:00.000Z", "call", 1, 0, "after", -62167305600000, -62167305600000, -62167305600000, -1, 11, 31, 0, 0, 0, 0, 5, "iso", "-000001-12-31T00:00:00.000Z", "json", "-000001-12-31T00:00:00.000Z"] },
  { time: -62198755200000, args: [32], expected: ["before", -62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5, "iso", "-000001-01-01T00:00:00.000Z", "json", "-000001-01-01T00:00:00.000Z", "call", 1, 32, "after", -62196076800000, -62196076800000, -62196076800000, -1, 1, 1, 0, 0, 0, 0, 1, "iso", "-000001-02-01T00:00:00.000Z", "json", "-000001-02-01T00:00:00.000Z"] },
  { time: 253402300799999, args: [32], expected: ["before", 253402300799999, 253402300799999, 253402300799999, 9999, 11, 31, 23, 59, 59, 999, 5, "iso", "9999-12-31T23:59:59.999Z", "json", "9999-12-31T23:59:59.999Z", "call", 1, 32, "after", 253402387199999, 253402387199999, 253402387199999, 10000, 0, 1, 23, 59, 59, 999, 6, "iso", "+010000-01-01T23:59:59.999Z", "json", "+010000-01-01T23:59:59.999Z"] },
  { time: 253402300800000, args: [1.9], expected: ["before", 253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6, "iso", "+010000-01-01T00:00:00.000Z", "json", "+010000-01-01T00:00:00.000Z", "call", 1, 1.9, "after", 253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6, "iso", "+010000-01-01T00:00:00.000Z", "json", "+010000-01-01T00:00:00.000Z"] },
  { time: 8640000000000000, args: [14], expected: ["before", 8640000000000000, 8640000000000000, 8640000000000000, 275760, 8, 13, 0, 0, 0, 0, 6, "iso", "+275760-09-13T00:00:00.000Z", "json", "+275760-09-13T00:00:00.000Z", "call", 1, 14, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: -8640000000000000, args: [19], expected: ["before", -8640000000000000, -8640000000000000, -8640000000000000, -271821, 3, 20, 0, 0, 0, 0, 2, "iso", "-271821-04-20T00:00:00.000Z", "json", "-271821-04-20T00:00:00.000Z", "call", 1, 19, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: NaN, args: [7], expected: ["before", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null, "call", 1, 7, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [NaN], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, NaN, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [Infinity], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, Infinity, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] }
];
function update(value: Date, args: InputRow["args"]): number {
  return value.setUTCDate(args[0]);
}
for (const row of rows) {
  const original = new Date(row.time), log: unknown[] = []; const values: Date[] = [new Date(NaN), original]; same(values[1], original); record(original, "before", original.getTime(), log);
  log.push("call", row.args.length, ...row.args); const result = update(values[1], row.args); record(original, "after", result, log); exact(log, row.expected);
}
