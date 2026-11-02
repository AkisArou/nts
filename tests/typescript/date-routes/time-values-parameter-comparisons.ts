/*---
description: "Date parameters yield numeric comparisons and subtraction across epoch, calendar extremes, clipping and invalid values."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// Two Date parameters supply valueOf numbers; the log records both times, subtraction and every ordered/equality comparison. Node leaves all ordered comparisons false for NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type ComparisonSample = [number, number, boolean, boolean, boolean];
const samples: ComparisonSample[] = [
  [0, 0, false, true, false], [-0, 0, false, true, false], [-1, -1, true, false, false],
  [0.75, 0, false, true, false], [-1.75, -1, true, false, false],
  [951827696789, 951827696789, false, false, true], [946684799999, 946684799999, false, false, true],
  [-62167219200000, -62167219200000, true, false, false], [-62198755200000, -62198755200000, true, false, false],
  [253402300799999, 253402300799999, false, false, true], [253402300800000, 253402300800000, false, false, true],
  [-8640000000000000, -8640000000000000, true, false, false], [8640000000000000, 8640000000000000, false, false, true],
  [8640000000000001, NaN, false, false, false], [NaN, NaN, false, false, false], [Infinity, NaN, false, false, false],
];
function inspect(value: Date, zero: Date, sample: ComparisonSample): void {
  const left = value.valueOf(), right = zero.valueOf(), wanted = sample[1], less = sample[2], equal = sample[3], greater = sample[4];
  const log: unknown[] = ["times", left, right, "difference", left - right, "compare", left < right, left <= right, left === right, left > right, left >= right];
  exact(log, ["times", wanted, 0, "difference", wanted, "compare", less, less || equal, equal, greater, greater || equal]);
  same(value.getTime(), wanted); same(zero.getTime(), 0);
}
for (const sample of samples) inspect(new Date(sample[0]), new Date(0), sample);
