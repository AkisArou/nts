/*---
description: "Arithmetic control for shared-map-value-field-crossover; A Map Date value and a typed field share writes without changing a separate equal-time Map value."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-objects]
---*/
// A Map<string, Date> lookup crosses an interface field; logs retain lookup identities, setter returns and both stored values. Node shares the primary object and preserves its independent peer. The control uses numeric cells and explicit alias indices without Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function reset(time: number): number { return Number.isFinite(time) ? ((time % 86400000) + 86400000) % 86400000 : 0; }
function milliseconds(time: number, ms: number): number { return clip(Math.floor(time / 1000) * 1000 + ms); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0, 456], [-0, 0, 0, 456],
  [-1, -1, 86399999, 86399456], [951827696789, 951827696789, 45296789, 45296456],
  [946684799999, 946684799999, 86399999, 86399456], [-62167219200000, -62167219200000, 0, 456],
  [-62198755200000, -62198755200000, 0, 456], [253402300799999, 253402300799999, 86399999, 86399456],
  [253402300800000, 253402300800000, 0, 456], [-8640000000000000, -8640000000000000, 0, 456],
  [8640000000000000, 8640000000000000, 0, 456], [NaN, NaN, 0, 456],
];
function inspect(sample: SharedSample): void {
  const cells = [clip(sample[0]), clip(sample[0])], original = 0, peer = 1, entries = { primary: original, peer };
  const found = entries.primary, other = entries.peer, box = { stamp: found };
  const log: unknown[] = ["identity", found === original, other === peer, found === other, "initial", cells[found], cells[other]];
  const first = cells[found] = reset(cells[found]); log.push("map-write", first, cells[box.stamp], cells[original], cells[other]);
  const second = cells[box.stamp] = milliseconds(cells[box.stamp], 456), again = entries.primary;
  log.push("field-write", second, again === original, cells[again], cells[original], cells[other], Object.keys(entries).length);
  exact(log, ["identity", true, true, false, "initial", sample[1], sample[1], "map-write", sample[2], sample[2], sample[2], sample[1], "field-write", sample[3], true, sample[3], sample[3], sample[1], 2]);
}
for (const sample of samples) inspect(sample);
