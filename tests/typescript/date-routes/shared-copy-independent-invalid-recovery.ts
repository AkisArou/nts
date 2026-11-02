/*---
description: "Copying a Date preserves its initial time and ISO text while both copies retain independent UTC mutation and invalid recovery."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-unions, ts-null-undefined, ts-errors, ts-arrow-functions]
---*/
// A Date argument reaches new Date(date); initial ISO output includes expanded years, then each object changes separately. Node creates a distinct copy and lets an invalid original and copy recover independently.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, number, number, number, string | null];
const samples: SharedSample[] = [
  [0, 0, 0, 951782400000, "1970-01-01T00:00:00.000Z"], [-0, 0, 0, 951782400000, "1970-01-01T00:00:00.000Z"],
  [-1, -1, 86399999, 951868799999, "1969-12-31T23:59:59.999Z"], [951827696789, 951827696789, 45296789, 951827696789, "2000-02-29T12:34:56.789Z"],
  [946684799999, 946684799999, 86399999, 951868799999, "1999-12-31T23:59:59.999Z"], [-62167219200000, -62167219200000, 0, 951782400000, "0000-01-01T00:00:00.000Z"],
  [-62198755200000, -62198755200000, 0, 951782400000, "-000001-01-01T00:00:00.000Z"], [253402300799999, 253402300799999, 86399999, 951868799999, "9999-12-31T23:59:59.999Z"],
  [253402300800000, 253402300800000, 0, 951782400000, "+010000-01-01T00:00:00.000Z"], [-8640000000000000, -8640000000000000, 0, 951782400000, "-271821-04-20T00:00:00.000Z"],
  [8640000000000000, 8640000000000000, 0, 951782400000, "+275760-09-13T00:00:00.000Z"], [NaN, NaN, 0, 951782400000, null],
];
function inspect(sample: SharedSample): void {
  const original: Date = new Date(sample[0]), copy: Date = new Date(original), log: unknown[] = ["copy", copy === original, original.getTime(), copy.getTime()];
  if (sample[4] === null) { assert.throws(RangeError, () => original.toISOString()); assert.throws(RangeError, () => copy.toISOString()); }
  else { assert.sameValue(original.toISOString(), sample[4]); assert.sameValue(copy.toISOString(), sample[4]); }
  const first = original.setUTCFullYear(1970, 0, 1); log.push("original-write", first, original.getTime(), copy.getTime());
  const second = copy.setUTCFullYear(2000, 1, 29); log.push("copy-write", second, original.getTime(), copy.getTime());
  exact(log, ["copy", false, sample[1], sample[1], "original-write", sample[2], sample[2], sample[1], "copy-write", sample[3], sample[2], sample[3]]);
}
for (const sample of samples) inspect(sample);
