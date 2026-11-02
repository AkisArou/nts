/*---
description: "Control for time-values-number-return-accumulation; A Date time becomes a numeric accumulator whose fractional and out-of-range intermediates survive a return and array slot before reconstruction."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// A Date parameter supplies a number accumulator that returns through a number array element; every addition and final construction is logged. Node clips only the constructed result, allowing an intermediate to leave and reenter the range. The control computes time values with number arithmetic and no Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
type AccumulationSample = [number, number[], number[], number];
const samples: AccumulationSample[] = [
  [0, [0.25, 0.25, 0.25, 0.25], [0.25, 0.5, 0.75, 1], 1],
  [0, [-0.25, -0.25, -0.25, -0.25], [-0.25, -0.5, -0.75, -1], -1],
  [8640000000000000, [1, -1], [8640000000000001, 8640000000000000], 8640000000000000],
  [-8640000000000000, [-1, 1], [-8640000000000001, -8640000000000000], -8640000000000000],
  [951827696789, [-951827696789, 946684799999], [0, 946684799999], 946684799999],
  [253402300799999, [1], [253402300800000], 253402300800000],
  [-62198755200000, [31536000000], [-62167219200000], -62167219200000],
  [NaN, [1, -1], [NaN, NaN], NaN], [0, [Infinity, -Infinity], [Infinity, NaN], NaN],
];
function accumulate(initial: number, steps: number[], log: unknown[]): number {
  let time = initial; log.push("initial", time);
  for (const step of steps) { time += step; log.push("add", step, time); } return time;
}
function inspect(sample: AccumulationSample): void {
  const initial = clip(sample[0]), log: unknown[] = [], expected: unknown[] = ["initial", sample[0]];
  const carried: number[] = [accumulate(initial, sample[1], log)], result = clip(carried[0]);
  for (let i = 0; i < sample[1].length; i++) expected.push("add", sample[1][i], sample[2][i]);
  log.push("carried", carried[0], "result", result, result); expected.push("carried", sample[2][sample[2].length - 1], "result", sample[3], sample[3]);
  exact(log, expected); same(initial, sample[0]); same(carried.length, 1);
}
for (const sample of samples) inspect(sample);
