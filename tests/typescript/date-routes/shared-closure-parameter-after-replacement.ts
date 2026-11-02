/*---
description: "A closure captures its Date argument object even after the source array entry is replaced."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-closures, ts-arrow-functions, ts-function-types]
---*/
// A Date parameter is captured by a returned reader; the source array is replaced and each object is mutated independently. Node keeps the reader attached to the old object, with exact identities, returns and times.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0, 321], [-0, 0, 0, 321],
  [-1, -1, 86399999, -679], [951827696789, 951827696789, 45296789, 951827696321],
  [946684799999, 946684799999, 86399999, 946684799321], [-62167219200000, -62167219200000, 0, -62167219199679],
  [-62198755200000, -62198755200000, 0, -62198755199679], [253402300799999, 253402300799999, 86399999, 253402300799321],
  [253402300800000, 253402300800000, 0, 253402300800321], [-8640000000000000, -8640000000000000, 0, -8639999999999679],
  [8640000000000000, 8640000000000000, 0, NaN], [NaN, NaN, 0, NaN],
];
function capture(value: Date): () => Date { return () => value; }
function inspect(sample: SharedSample): void {
  const original: Date = new Date(sample[0]), values: Date[] = [original], read: () => Date = capture(values[0]);
  values[0] = new Date(sample[0]);
  const log: unknown[] = ["replace", read() === original, read() === values[0], read().getTime(), values[0].getTime()];
  const first = original.setUTCFullYear(1970, 0, 1); log.push("old-write", first, read().getTime(), values[0].getTime());
  const second = values[0].setUTCMilliseconds(321); log.push("new-write", second, read().getTime(), original.getTime(), values[0].getTime());
  exact(log, ["replace", true, false, sample[1], sample[1], "old-write", sample[2], sample[2], sample[1], "new-write", sample[3], sample[2], sample[2], sample[3]]);
  same(read(), original); same(read() === values[0], false);
}
for (const sample of samples) inspect(sample);
