/*---
description: "Arithmetic control for shared-equal-time-map-keys; Distinct equal-time Dates remain distinct Map keys before and after mutating one key object."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-null-undefined]
---*/
// Two Date keys begin with equal numeric times; logs retain map size, key lookups, failed fresh-key lookups and both times after one update. Node indexes identity independently of the mutable time value. The control uses numeric cells and explicit alias indices without Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function reset(time: number): number { return Number.isFinite(time) ? ((time % 86400000) + 86400000) % 86400000 : 0; }
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
  const cells = [clip(sample[0]), clip(sample[0]), clip(sample[0])], first: number = 0, second: number = 1, probe: number = 2, values = ["first", "second"];
  const log: unknown[] = ["keys", first === second, values.length, values[first], values[second], values[probe], cells[first], cells[second]];
  const returned = cells[first] = reset(cells[first]); cells.push(cells[first]); const fresh: number = 3;
  log.push("mutate", returned, cells[first], cells[second], values.length, values[first], values[second], values[fresh], first < values.length, second < values.length, fresh < values.length);
  exact(log, ["keys", false, 2, "first", "second", undefined, sample[1], sample[1], "mutate", sample[2], sample[2], sample[1], 2, "first", "second", undefined, true, true, false]);
}
for (const sample of samples) inspect(sample);
