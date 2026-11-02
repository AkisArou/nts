/*---
description: "Arithmetic control for shared-field-array-alias-writes; A Date field and array element share each UTC mutation while an equal-time sibling remains independent."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-objects]
---*/
// One Date crosses an interface field and Date array; logs hold identity, both setter returns and all alias/sibling times. Node writes through either alias and leaves the equal-time sibling unchanged. The control uses numeric cells and explicit alias indices without Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function milliseconds(time: number, ms: number): number { return clip(Math.floor(time / 1000) * 1000 + ms); }
function seconds(time: number, second: number, ms: number): number { return clip(Math.floor(time / 60000) * 60000 + second * 1000 + ms); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 123, 1234], [-0, 0, 123, 1234],
  [-1, -1, -877, -58766], [951827696789, 951827696789, 951827696123, 951827641234],
  [946684799999, 946684799999, 946684799123, 946684741234], [-62167219200000, -62167219200000, -62167219199877, -62167219198766],
  [-62198755200000, -62198755200000, -62198755199877, -62198755198766], [253402300799999, 253402300799999, 253402300799123, 253402300741234],
  [253402300800000, 253402300800000, 253402300800123, 253402300801234], [-8640000000000000, -8640000000000000, -8639999999999877, -8639999999998766],
  [8640000000000000, 8640000000000000, NaN, NaN], [NaN, NaN, NaN, NaN],
];
function inspect(sample: SharedSample): void {
  const cells = [clip(sample[0]), clip(sample[0])], original = 0, box = { stamp: original }, values = [original, 1];
  const log: unknown[] = ["identity", box.stamp === original, values[0] === original, values[1] === original, "initial", cells[original], cells[values[1]]];
  const first = cells[box.stamp] = milliseconds(cells[box.stamp], 123); log.push("field-write", first, cells[original], cells[values[0]], cells[values[1]]);
  const second = cells[values[0]] = seconds(cells[values[0]], 1, 234); log.push("array-write", second, cells[original], cells[box.stamp], cells[values[1]]);
  exact(log, ["identity", true, true, false, "initial", sample[1], sample[1], "field-write", sample[2], sample[2], sample[2], sample[1], "array-write", sample[3], sample[3], sample[3], sample[1]]);
  same(box.stamp, original); same(values[0], original); same(cells[values[1]], sample[1]);
}
for (const sample of samples) inspect(sample);
