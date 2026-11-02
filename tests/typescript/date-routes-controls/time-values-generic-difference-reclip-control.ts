/*---
description: "Control for time-values-generic-difference-reclip; A generic pair of Dates returns an unclipped numeric difference that is clipped only when reconstructed as a Date."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// Date arguments cross a constrained generic subtraction and number return; the log retains endpoints, the full difference and its reconstructed time. Node permits differences larger than the Date range. The control computes time values with number arithmetic and no Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
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
function difference(from: number, to: number): number { return to - from; }
function inspect(sample: DifferenceSample): void {
  const from = clip(sample[0]), to = clip(sample[1]);
  const elapsed = difference(from, to), reconstructed = clip(elapsed);
  const log: unknown[] = ["from", from, "to", to, "difference", elapsed, "reconstructed", reconstructed, reconstructed];
  exact(log, ["from", sample[0], "to", sample[1], "difference", sample[2], "reconstructed", sample[3], sample[3]]);
  same(elapsed, sample[2]); same(from, sample[0]); same(to, sample[1]);
}
for (const sample of samples) inspect(sample);
