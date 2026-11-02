/*---
description: "A number parameter becomes a returned Date whose time is clipped before truncation and whose zero is positive."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// A number parameter crosses a Date return; the log holds the input, getTime, valueOf and reciprocal. Node clips nonfinite/out-of-range values, truncates fractions and returns positive zero.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TimeValueSample = [number, number];
const samples: TimeValueSample[] = [
  [0, 0], [-0, 0], [0.75, 0], [-0.75, 0], [1.75, 1], [-1.75, -1],
  [-1, -1], [951827696789, 951827696789], [946684799999, 946684799999],
  [-62167219200000, -62167219200000], [-62198755200000, -62198755200000],
  [253402300799999, 253402300799999], [253402300800000, 253402300800000],
  [8640000000000000 - 1, 8639999999999999], [8640000000000000, 8640000000000000],
  [8640000000000000 + 0.5, 8640000000000000], [8640000000000000 + 0.75, NaN], [8640000000000000 + 1, NaN],
  [-8640000000000000 + 1, -8639999999999999], [-8640000000000000, -8640000000000000],
  [-8640000000000000 - 0.5, -8640000000000000], [-8640000000000000 - 0.75, NaN], [-8640000000000000 - 1, NaN],
  [NaN, NaN], [Infinity, NaN], [-Infinity, NaN],
];
function create(time: number): Date { return new Date(time); }
function inspect(input: number, wanted: number): void {
  const value: Date = create(input), time = value.getTime(), primitive = value.valueOf();
  const log: unknown[] = ["input", input, "time", time, "value", primitive, "inverse", 1 / time];
  exact(log, ["input", input, "time", wanted, "value", wanted, "inverse", 1 / wanted]);
  same(value.getTime(), wanted); same(value.valueOf(), wanted);
}
for (const [input, wanted] of samples) inspect(input, wanted);
