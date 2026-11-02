/*---
description: "A structural setter interface preserves omitted and supplied millisecond arguments."
features: [ts-date-routes, ts-date-route-setters, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-errors, ts-instanceof, ts-spread, ts-tuples, ts-indexed-access, ts-unions, ts-null-undefined, ts-interfaces, ts-optional-parameters]
---*/
// The interface setter receives typed second/millisecond tuples; node preserves omitted milliseconds, normalizes explicit operands and logs the caller-visible result.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); assert.sameValue(actual, expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function record(value: Date, label: string, result: number, log: unknown[]): void {
  log.push(label, result, value.getTime(), value.valueOf(), value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds(), value.getUTCDay());
  try { log.push("iso", value.toISOString()); } catch (error) { same(error instanceof RangeError, true); log.push("RangeError"); }
  log.push("json", value.toJSON());
}
type InputRow = { time: number; args: [number] | [number, number | undefined]; expected: unknown[] };
const rows: InputRow[] = [
  { time: 0, args: [-0], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, -0, "after", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z"] },
  { time: -1, args: [-1, 1001], expected: ["before", -1, -1, -1, 1969, 11, 31, 23, 59, 59, 999, 3, "iso", "1969-12-31T23:59:59.999Z", "json", "1969-12-31T23:59:59.999Z", "call", 2, -1, 1001, "after", -59999, -59999, -59999, 1969, 11, 31, 23, 59, 0, 1, 3, "iso", "1969-12-31T23:59:00.001Z", "json", "1969-12-31T23:59:00.001Z"] },
  { time: 951827696789, args: [61.9], expected: ["before", 951827696789, 951827696789, 951827696789, 2000, 1, 29, 12, 34, 56, 789, 2, "iso", "2000-02-29T12:34:56.789Z", "json", "2000-02-29T12:34:56.789Z", "call", 1, 61.9, "after", 951827701789, 951827701789, 951827701789, 2000, 1, 29, 12, 35, 1, 789, 2, "iso", "2000-02-29T12:35:01.789Z", "json", "2000-02-29T12:35:01.789Z"] },
  { time: 946684799999, args: [-1.9, -1], expected: ["before", 946684799999, 946684799999, 946684799999, 1999, 11, 31, 23, 59, 59, 999, 5, "iso", "1999-12-31T23:59:59.999Z", "json", "1999-12-31T23:59:59.999Z", "call", 2, -1.9, -1, "after", 946684738999, 946684738999, 946684738999, 1999, 11, 31, 23, 58, 58, 999, 5, "iso", "1999-12-31T23:58:58.999Z", "json", "1999-12-31T23:58:58.999Z"] },
  { time: -62167219200000, args: [0, 0], expected: ["before", -62167219200000, -62167219200000, -62167219200000, 0, 0, 1, 0, 0, 0, 0, 6, "iso", "0000-01-01T00:00:00.000Z", "json", "0000-01-01T00:00:00.000Z", "call", 2, 0, 0, "after", -62167219200000, -62167219200000, -62167219200000, 0, 0, 1, 0, 0, 0, 0, 6, "iso", "0000-01-01T00:00:00.000Z", "json", "0000-01-01T00:00:00.000Z"] },
  { time: -62198755200000, args: [1], expected: ["before", -62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5, "iso", "-000001-01-01T00:00:00.000Z", "json", "-000001-01-01T00:00:00.000Z", "call", 1, 1, "after", -62198755199000, -62198755199000, -62198755199000, -1, 0, 1, 0, 0, 1, 0, 5, "iso", "-000001-01-01T00:00:01.000Z", "json", "-000001-01-01T00:00:01.000Z"] },
  { time: 253402300799999, args: [60], expected: ["before", 253402300799999, 253402300799999, 253402300799999, 9999, 11, 31, 23, 59, 59, 999, 5, "iso", "9999-12-31T23:59:59.999Z", "json", "9999-12-31T23:59:59.999Z", "call", 1, 60, "after", 253402300800999, 253402300800999, 253402300800999, 10000, 0, 1, 0, 0, 0, 999, 6, "iso", "+010000-01-01T00:00:00.999Z", "json", "+010000-01-01T00:00:00.999Z"] },
  { time: 253402300800000, args: [0, undefined], expected: ["before", 253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6, "iso", "+010000-01-01T00:00:00.000Z", "json", "+010000-01-01T00:00:00.000Z", "call", 2, 0, undefined, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 8640000000000000, args: [1], expected: ["before", 8640000000000000, 8640000000000000, 8640000000000000, 275760, 8, 13, 0, 0, 0, 0, 6, "iso", "+275760-09-13T00:00:00.000Z", "json", "+275760-09-13T00:00:00.000Z", "call", 1, 1, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: -8640000000000000, args: [-1], expected: ["before", -8640000000000000, -8640000000000000, -8640000000000000, -271821, 3, 20, 0, 0, 0, 0, 2, "iso", "-271821-04-20T00:00:00.000Z", "json", "-271821-04-20T00:00:00.000Z", "call", 1, -1, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: NaN, args: [7], expected: ["before", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null, "call", 1, 7, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [NaN], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, NaN, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [Infinity], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, Infinity, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [1, undefined], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 2, 1, undefined, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] }
];
interface UTCSetter { setUTCSeconds(a0: number, a1?: number): number; }
function update(value: UTCSetter, args: InputRow["args"]): number {
  if (args.length === 1) return value.setUTCSeconds(args[0]);
  return value.setUTCSeconds(args[0], args[1]);
}
for (const row of rows) {
  const original = new Date(row.time), log: unknown[] = []; record(original, "before", original.getTime(), log);
  log.push("call", row.args.length, ...row.args); const result = update(original, row.args); record(original, "after", result, log); exact(log, row.expected);
}
