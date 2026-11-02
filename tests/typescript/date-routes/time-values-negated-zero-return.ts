/*---
description: "Negating a Date time returns a signed numeric zero that survives generic storage and is normalized only by Date reconstruction."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-generics, ts-objects]
---*/
// A Date parameter returns a negated number through a generic identity and numeric field; logs include reciprocal signs before and after reconstruction. Node preserves carried negative zero but stores positive zero in the new Date.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type NegationSample = [number, number, number, number];
const samples: NegationSample[] = [
  [0, 0, -0, 0], [-0, 0, -0, 0], [0.75, 0, -0, 0], [-0.75, 0, -0, 0],
  [1.75, 1, -1, -1], [-1.75, -1, 1, 1],
  [951827696789, 951827696789, -951827696789, -951827696789],
  [-62167219200000, -62167219200000, 62167219200000, 62167219200000],
  [-62198755200000, -62198755200000, 62198755200000, 62198755200000],
  [253402300800000, 253402300800000, -253402300800000, -253402300800000],
  [8640000000000000, 8640000000000000, -8640000000000000, -8640000000000000],
  [-8640000000000000, -8640000000000000, 8640000000000000, 8640000000000000],
  [NaN, NaN, NaN, NaN], [Infinity, NaN, NaN, NaN], [-Infinity, NaN, NaN, NaN],
];
function negate(value: Date): number { return -value.valueOf(); }
function retain<T>(value: T): T { return value; }
function inspect(sample: NegationSample): void {
  const value: Date = new Date(sample[0]), carried: { time: number } = { time: retain(negate(value)) };
  const result: Date = new Date(carried.time), time = result.getTime();
  const log: unknown[] = ["initial", value.getTime(), "carried", carried.time, 1 / carried.time, "result", time, 1 / time, result.valueOf()];
  exact(log, ["initial", sample[1], "carried", sample[2], 1 / sample[2], "result", sample[3], 1 / sample[3], sample[3]]);
  same(carried.time, sample[2]); same(value.valueOf(), sample[1]);
}
for (const sample of samples) inspect(sample);
