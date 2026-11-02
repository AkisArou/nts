/*---
description: "Control for time-values-nullable-field-fallback; A nullable Date field distinguishes missing values from stored zero and NaN time values before selecting a numeric fallback."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects]
---*/
// A Date-or-null-or-undefined interface field is narrowed before valueOf; the branch and chosen time are logged. Node selects the fallback only for missing objects, preserving zero and invalid stored times. The control computes time values with number arithmetic and no Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
type NullableTimeSample = [number, number];
const samples: NullableTimeSample[] = [
  [0, 0], [-0, 0], [-1, -1], [0.75, 0], [951827696789, 951827696789], [946684799999, 946684799999],
  [-62167219200000, -62167219200000], [-62198755200000, -62198755200000],
  [253402300799999, 253402300799999], [253402300800000, 253402300800000],
  [8640000000000000, 8640000000000000], [-8640000000000000, -8640000000000000], [NaN, NaN], [Infinity, NaN],
];
interface NumericTime { kind: string; time: number; fallback: number; }
function choose(holder: NumericTime, log: unknown[]): number {
  if (holder.kind === "null") { log.push("null", holder.fallback); return holder.fallback; }
  if (holder.kind === "undefined") { log.push("undefined", holder.fallback); return holder.fallback; }
  const time = holder.time; log.push("date", time); return time;
}
function inspect(sample: NullableTimeSample): void {
  for (const kind of ["date", "null", "undefined"]) {
    const holder: NumericTime = { kind, time: clip(sample[0]), fallback: 4321.75 }, log: unknown[] = [];
    const chosen = choose(holder, log), wanted = kind === "date" ? sample[1] : 4321.75;
    log.push("chosen", chosen); exact(log, [kind, wanted, "chosen", wanted]); same(chosen, wanted);
    if (holder.kind === "date") same(holder.time, sample[1]);
  }
}
for (const sample of samples) inspect(sample);
