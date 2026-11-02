/*---
description: "A nullable Date field distinguishes missing values from stored zero and NaN time values before selecting a numeric fallback."
features: [ts-date-routes, ts-date-route-time-values, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-unions, ts-null-undefined, ts-narrowing]
---*/
// A Date-or-null-or-undefined interface field is narrowed before valueOf; the branch and chosen time are logged. Node selects the fallback only for missing objects, preserving zero and invalid stored times.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type NullableTimeSample = [number, number];
const samples: NullableTimeSample[] = [
  [0, 0], [-0, 0], [-1, -1], [0.75, 0], [951827696789, 951827696789], [946684799999, 946684799999],
  [-62167219200000, -62167219200000], [-62198755200000, -62198755200000],
  [253402300799999, 253402300799999], [253402300800000, 253402300800000],
  [8640000000000000, 8640000000000000], [-8640000000000000, -8640000000000000], [NaN, NaN], [Infinity, NaN],
];
interface MaybeTime { stamp: Date | null | undefined; fallback: number; }
function choose(holder: MaybeTime, log: unknown[]): number {
  const value = holder.stamp;
  if (value === null) { log.push("null", holder.fallback); return holder.fallback; }
  if (value === undefined) { log.push("undefined", holder.fallback); return holder.fallback; }
  const time = value.valueOf(); log.push("date", time); return time;
}
function inspect(sample: NullableTimeSample): void {
  for (const kind of ["date", "null", "undefined"]) {
    const holder: MaybeTime = { stamp: kind === "date" ? new Date(sample[0]) : kind === "null" ? null : undefined, fallback: 4321.75 }, log: unknown[] = [];
    const chosen: number = choose(holder, log), wanted = kind === "date" ? sample[1] : 4321.75;
    log.push("chosen", chosen); exact(log, [kind, wanted, "chosen", wanted]); same(chosen, wanted);
    if (holder.stamp !== null && holder.stamp !== undefined) same(holder.stamp.getTime(), sample[1]);
  }
}
for (const sample of samples) inspect(sample);
