/*---
description: "Distinct equal-time Dates remain distinct Map keys before and after mutating one key object."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-map-set, ts-null-undefined]
---*/
// Two Date keys begin with equal numeric times; logs retain map size, key lookups, failed fresh-key lookups and both times after one update. Node indexes identity independently of the mutable time value.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0], [-0, 0, 0],
  [-1, -1, 86399999], [951827696789, 951827696789, 45296789],
  [946684799999, 946684799999, 86399999], [-62167219200000, -62167219200000, 0],
  [-62198755200000, -62198755200000, 0], [253402300799999, 253402300799999, 86399999],
  [253402300800000, 253402300800000, 0], [-8640000000000000, -8640000000000000, 0],
  [8640000000000000, 8640000000000000, 0], [NaN, NaN, 0],
];
function inspect(sample: SharedSample): void {
  const first: Date = new Date(sample[0]), second: Date = new Date(sample[0]), probe: Date = new Date(sample[0]);
  const values: Map<Date, string> = new Map([[first, "first"], [second, "second"]]);
  const log: unknown[] = ["keys", first === second, values.size, values.get(first), values.get(second), values.get(probe), first.getTime(), second.getTime()];
  const returned = first.setUTCFullYear(1970, 0, 1), fresh: Date = new Date(first.getTime());
  log.push("mutate", returned, first.getTime(), second.getTime(), values.size, values.get(first), values.get(second), values.get(fresh), values.has(first), values.has(second), values.has(fresh));
  exact(log, ["keys", false, 2, "first", "second", undefined, sample[1], sample[1], "mutate", sample[2], sample[2], sample[1], 2, "first", "second", undefined, true, true, false]);
}
for (const sample of samples) inspect(sample);
