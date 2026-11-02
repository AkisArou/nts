/*---
description: "A generic pair of Dates returns an unclipped numeric difference that is clipped only when reconstructed as a Date."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-generics, ts-generic-constraints]
---*/
// Date arguments cross a constrained generic subtraction and number return; the log retains endpoints, the full difference and its reconstructed time. Node permits differences larger than the Date range.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type DifferenceSample = [number, number, number, number];
const samples: DifferenceSample[] = [
  [0, 0, 0, 0], [-1, 0, 1, 1], [0, -1, -1, -1],
  [946684799999, 951827696789, 5142896790, 5142896790],
  [-62167219200000, -62198755200000, -31536000000, -31536000000],
  [253402300799999, 253402300800000, 1, 1],
  [-8640000000000000, 8640000000000000, 17280000000000000, NaN],
  [8640000000000000, -8640000000000000, -17280000000000000, NaN],
  [0, 8640000000000000, 8640000000000000, 8640000000000000],
  [NaN, 0, NaN, NaN], [0, NaN, NaN, NaN],
];
function difference<T extends Date>(from: T, to: T): number { return to.valueOf() - from.valueOf(); }
function inspect(sample: DifferenceSample): void {
  const from: Date = new Date(sample[0]), to: Date = new Date(sample[1]);
  const elapsed: number = difference(from, to), reconstructed: Date = new Date(elapsed);
  const log: unknown[] = ["from", from.getTime(), "to", to.getTime(), "difference", elapsed, "reconstructed", reconstructed.getTime(), reconstructed.valueOf()];
  exact(log, ["from", sample[0], "to", sample[1], "difference", sample[2], "reconstructed", sample[3], sample[3]]);
  same(elapsed, sample[2]); same(from.valueOf(), sample[0]); same(to.valueOf(), sample[1]);
}
for (const sample of samples) inspect(sample);
