/*---
description: "A Date field and array element share each UTC mutation while an equal-time sibling remains independent."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects]
---*/
// One Date crosses an interface field and Date array; logs hold identity, both setter returns and all alias/sibling times. Node writes through either alias and leaves the equal-time sibling unchanged.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 123, 1234], [-0, 0, 123, 1234],
  [-1, -1, -877, -58766], [951827696789, 951827696789, 951827696123, 951827641234],
  [946684799999, 946684799999, 946684799123, 946684741234], [-62167219200000, -62167219200000, -62167219199877, -62167219198766],
  [-62198755200000, -62198755200000, -62198755199877, -62198755198766], [253402300799999, 253402300799999, 253402300799123, 253402300741234],
  [253402300800000, 253402300800000, 253402300800123, 253402300801234], [-8640000000000000, -8640000000000000, -8639999999999877, -8639999999998766],
  [8640000000000000, 8640000000000000, NaN, NaN], [NaN, NaN, NaN, NaN],
];
interface DateSlot { stamp: Date; }
function inspect(sample: SharedSample): void {
  const original: Date = new Date(sample[0]), box: DateSlot = { stamp: original }, values: Date[] = [original, new Date(sample[0])];
  const log: unknown[] = ["identity", box.stamp === original, values[0] === original, values[1] === original, "initial", original.getTime(), values[1].getTime()];
  const first = box.stamp.setUTCMilliseconds(123); log.push("field-write", first, original.getTime(), values[0].getTime(), values[1].getTime());
  const second = values[0].setUTCSeconds(1, 234); log.push("array-write", second, original.getTime(), box.stamp.getTime(), values[1].getTime());
  exact(log, ["identity", true, true, false, "initial", sample[1], sample[1], "field-write", sample[2], sample[2], sample[2], sample[1], "array-write", sample[3], sample[3], sample[3], sample[1]]);
  same(box.stamp, original); same(values[0], original); same(values[1].valueOf(), sample[1]);
}
for (const sample of samples) inspect(sample);
