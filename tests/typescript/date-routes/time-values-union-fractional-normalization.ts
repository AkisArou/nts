/*---
description: "A Date-or-number union keeps raw fractional numbers distinct from clipped Date values before the same arithmetic and reconstruction."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-unions, ts-narrowing]
---*/
// A number-or-Date parameter narrows by typeof; logs record the chosen branch, returned value, half-millisecond shift and reconstructed time. Node preserves raw fractions until construction.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type FractionSample = [number, number, number, number];
const samples: FractionSample[] = [
  [0, 0, 0, 0], [-0, 0, 0, 0], [0.75, 0, 1, 0], [-0.75, 0, 0, 0],
  [1.75, 1, 2, 1], [-1.75, -1, -1, 0], [-1, -1, 0, 0],
  [951827696789, 951827696789, 951827696789, 951827696789],
  [8640000000000000, 8640000000000000, 8640000000000000, 8640000000000000],
  [8640000000000001, NaN, NaN, NaN], [-8640000000000001, NaN, -8640000000000000, NaN],
  [NaN, NaN, NaN, NaN], [Infinity, NaN, NaN, NaN], [-Infinity, NaN, NaN, NaN],
];
function read(value: number | Date, log: unknown[]): number {
  if (typeof value === "number") { log.push("number", value); return value; }
  const time = value.valueOf(); log.push("date", time); return time;
}
function inspect(sample: FractionSample): void {
  for (const kind of ["number", "date"]) {
    const value: number | Date = kind === "number" ? sample[0] : new Date(sample[0]), log: unknown[] = [];
    const returned = read(value, log), shifted = returned + 0.5, result: Date = new Date(shifted);
    const wanted = kind === "number" ? sample[0] : sample[1], final = kind === "number" ? sample[2] : sample[3];
    log.push("shift", shifted, "result", result.getTime(), result.valueOf());
    exact(log, [kind, wanted, "shift", wanted + 0.5, "result", final, final]); same(returned, wanted);
  }
}
for (const sample of samples) inspect(sample);
