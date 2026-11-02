/*---
description: "Control for time-values-union-fractional-normalization; A Date-or-number union keeps raw fractional numbers distinct from clipped Date values before the same arithmetic and reconstruction."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects]
---*/
// A number-or-Date parameter narrows by typeof; logs record the chosen branch, returned value, half-millisecond shift and reconstructed time. Node preserves raw fractions until construction. The control computes time values with number arithmetic and no Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
type FractionSample = [number, number, number, number];
const samples: FractionSample[] = [
  [0, 0, 0, 0], [-0, 0, 0, 0], [0.75, 0, 1, 0], [-0.75, 0, 0, 0],
  [1.75, 1, 2, 1], [-1.75, -1, -1, 0], [-1, -1, 0, 0],
  [951827696789, 951827696789, 951827696789, 951827696789],
  [8640000000000000, 8640000000000000, 8640000000000000, 8640000000000000],
  [8640000000000001, NaN, NaN, NaN], [-8640000000000001, NaN, -8640000000000000, NaN],
  [NaN, NaN, NaN, NaN], [Infinity, NaN, NaN, NaN], [-Infinity, NaN, NaN, NaN],
];
interface NumericInput { kind: string; raw: number; clipped: number; }
function read(value: NumericInput, log: unknown[]): number {
  if (value.kind === "number") { log.push("number", value.raw); return value.raw; }
  const time = value.clipped; log.push("date", time); return time;
}
function inspect(sample: FractionSample): void {
  for (const kind of ["number", "date"]) {
    const value: NumericInput = { kind, raw: sample[0], clipped: clip(sample[0]) }, log: unknown[] = [];
    const returned = read(value, log), shifted = returned + 0.5, result = clip(shifted);
    const wanted = kind === "number" ? sample[0] : sample[1], final = kind === "number" ? sample[2] : sample[3];
    log.push("shift", shifted, "result", result, result);
    exact(log, [kind, wanted, "shift", wanted + 0.5, "result", final, final]); same(returned, wanted);
  }
}
for (const sample of samples) inspect(sample);
