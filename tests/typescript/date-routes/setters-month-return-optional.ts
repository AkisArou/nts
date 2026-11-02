/*---
description: "A declared Date return preserves month overflow and optional day semantics."
features: [ts-date-routes, ts-date-route-setters, ts-functions, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-iteration, ts-objects, ts-type-aliases, ts-errors, ts-instanceof, ts-spread, ts-tuples, ts-indexed-access, ts-unions, ts-null-undefined]
---*/
// A declared Date return carries one shared receiver; node logs retained days, explicit days and normalized years before and after mutation.
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
  { time: -1, args: [-1], expected: ["before", -1, -1, -1, 1969, 11, 31, 23, 59, 59, 999, 3, "iso", "1969-12-31T23:59:59.999Z", "json", "1969-12-31T23:59:59.999Z", "call", 1, -1, "after", -31536000001, -31536000001, -31536000001, 1968, 11, 31, 23, 59, 59, 999, 2, "iso", "1968-12-31T23:59:59.999Z", "json", "1968-12-31T23:59:59.999Z"] },
  { time: 951827696789, args: [12.9], expected: ["before", 951827696789, 951827696789, 951827696789, 2000, 1, 29, 12, 34, 56, 789, 2, "iso", "2000-02-29T12:34:56.789Z", "json", "2000-02-29T12:34:56.789Z", "call", 1, 12.9, "after", 980771696789, 980771696789, 980771696789, 2001, 0, 29, 12, 34, 56, 789, 1, "iso", "2001-01-29T12:34:56.789Z", "json", "2001-01-29T12:34:56.789Z"] },
  { time: 946684799999, args: [1], expected: ["before", 946684799999, 946684799999, 946684799999, 1999, 11, 31, 23, 59, 59, 999, 5, "iso", "1999-12-31T23:59:59.999Z", "json", "1999-12-31T23:59:59.999Z", "call", 1, 1, "after", 920505599999, 920505599999, 920505599999, 1999, 2, 3, 23, 59, 59, 999, 3, "iso", "1999-03-03T23:59:59.999Z", "json", "1999-03-03T23:59:59.999Z"] },
  { time: -62167219200000, args: [0, 0], expected: ["before", -62167219200000, -62167219200000, -62167219200000, 0, 0, 1, 0, 0, 0, 0, 6, "iso", "0000-01-01T00:00:00.000Z", "json", "0000-01-01T00:00:00.000Z", "call", 2, 0, 0, "after", -62167305600000, -62167305600000, -62167305600000, -1, 11, 31, 0, 0, 0, 0, 5, "iso", "-000001-12-31T00:00:00.000Z", "json", "-000001-12-31T00:00:00.000Z"] },
  { time: -62198755200000, args: [12], expected: ["before", -62198755200000, -62198755200000, -62198755200000, -1, 0, 1, 0, 0, 0, 0, 5, "iso", "-000001-01-01T00:00:00.000Z", "json", "-000001-01-01T00:00:00.000Z", "call", 1, 12, "after", -62167219200000, -62167219200000, -62167219200000, 0, 0, 1, 0, 0, 0, 0, 6, "iso", "0000-01-01T00:00:00.000Z", "json", "0000-01-01T00:00:00.000Z"] },
  { time: 253402300799999, args: [12], expected: ["before", 253402300799999, 253402300799999, 253402300799999, 9999, 11, 31, 23, 59, 59, 999, 5, "iso", "9999-12-31T23:59:59.999Z", "json", "9999-12-31T23:59:59.999Z", "call", 1, 12, "after", 253404979199999, 253404979199999, 253404979199999, 10000, 0, 31, 23, 59, 59, 999, 1, "iso", "+010000-01-31T23:59:59.999Z", "json", "+010000-01-31T23:59:59.999Z"] },
  { time: 253402300800000, args: [0, undefined], expected: ["before", 253402300800000, 253402300800000, 253402300800000, 10000, 0, 1, 0, 0, 0, 0, 6, "iso", "+010000-01-01T00:00:00.000Z", "json", "+010000-01-01T00:00:00.000Z", "call", 2, 0, undefined, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 8640000000000000, args: [9], expected: ["before", 8640000000000000, 8640000000000000, 8640000000000000, 275760, 8, 13, 0, 0, 0, 0, 6, "iso", "+275760-09-13T00:00:00.000Z", "json", "+275760-09-13T00:00:00.000Z", "call", 1, 9, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: -8640000000000000, args: [2], expected: ["before", -8640000000000000, -8640000000000000, -8640000000000000, -271821, 3, 20, 0, 0, 0, 0, 2, "iso", "-271821-04-20T00:00:00.000Z", "json", "-271821-04-20T00:00:00.000Z", "call", 1, 2, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: NaN, args: [7], expected: ["before", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null, "call", 1, 7, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [NaN], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, NaN, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [Infinity], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 1, Infinity, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] },
  { time: 0, args: [1, undefined], expected: ["before", 0, 0, 0, 1970, 0, 1, 0, 0, 0, 0, 4, "iso", "1970-01-01T00:00:00.000Z", "json", "1970-01-01T00:00:00.000Z", "call", 2, 1, undefined, "after", NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, "RangeError", "json", null] }
];
function update(value: Date, args: InputRow["args"]): number {
  if (args.length === 1) return value.setUTCMonth(args[0]);
  return value.setUTCMonth(args[0], args[1]);
}
function carry(value: Date): Date { return value; }
for (const row of rows) {
  const original = new Date(row.time), log: unknown[] = []; record(original, "before", original.getTime(), log);
  log.push("call", row.args.length, ...row.args); const result = update(carry(original), row.args); record(original, "after", result, log); exact(log, row.expected);
}
