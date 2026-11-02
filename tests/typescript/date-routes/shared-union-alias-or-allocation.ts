/*---
description: "A Date-or-number-or-string parameter aliases Date inputs and allocates independent objects for numeric and ISO inputs."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-unions, ts-narrowing, ts-instanceof]
---*/
// A typed union narrows by instanceof and typeof before UTC mutation; logs keep branch, initial/final times and identity to the original. Node aliases the Date branch and allocates for numbers and explicit-zone ISO text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, string, number, number];
const samples: SharedSample[] = [
  [0, "1970-01-01T01:30:00.000+01:30", 0, 0], [-0, "1970-01-01T00:00:00.000Z", 0, 0],
  [-1, "1970-01-01T00:59:59.999+01:00", -1, 86399999], [951827696789, "2000-02-29T12:34:56.789Z", 951827696789, 45296789],
  [946684799999, "1999-12-31T23:59:59.999Z", 946684799999, 86399999], [-62167219200000, "0000-01-01T00:00:00.000Z", -62167219200000, 0],
  [-62198755200000, "-000001-01-01T00:00:00.000Z", -62198755200000, 0], [253402300799999, "9999-12-31T23:59:59.999Z", 253402300799999, 86399999],
  [253402300800000, "+010000-01-01T00:00:00.000Z", 253402300800000, 0], [-8640000000000000, "-271821-04-20T00:00:00.000Z", -8640000000000000, 0],
  [8640000000000000, "+275760-09-13T00:00:00.000Z", 8640000000000000, 0], [NaN, "2000-01-01T00:00:00.000+24:00", NaN, 0],
];
function choose(value: Date | number | string, log: unknown[]): Date {
  if (value instanceof Date) { log.push("date"); return value; }
  if (typeof value === "number") { log.push("number"); return new Date(value); }
  log.push("string"); return new Date(value);
}
function inspect(sample: SharedSample): void {
  for (const kind of ["date", "number", "string"]) {
    const original: Date = new Date(sample[0]), input: Date | number | string = kind === "date" ? original : kind === "number" ? sample[0] : sample[1], log: unknown[] = [];
    const chosen: Date = choose(input, log); log.push("before", chosen === original, chosen.getTime(), original.getTime());
    const returned = chosen.setUTCFullYear(1970, 0, 1); log.push("after", returned, chosen.getTime(), original.getTime(), chosen === original);
    const aliases = kind === "date"; exact(log, [kind, "before", aliases, sample[2], sample[2], "after", sample[3], sample[3], aliases ? sample[3] : sample[2], aliases]);
  }
}
for (const sample of samples) inspect(sample);
