/*---
description: A Date tuple preserves one shared Date across both tuple slots.
features: [ts-structuredclone-route-collections, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-tuples, ts-numbers, ts-type-aliases]
---*/
// A declared [Date, Date] tuple carries a shared valid or invalid Date; node copies the array and retains exactly one cloned Date.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
type DatePair = [Date, Date];
function copyPair(source: DatePair): DatePair { return structuredClone(source); }
for (const time of [0, -86400000, NaN]) {
  const date = new Date(time), source: DatePair = [date, date], result = copyPair(source);
  fresh(result, source, Array.prototype, ["0", "1"]); same(result.length, 2);
  fresh(result[0], date, Date.prototype, []); same(result[0], result[1]); same(result[0].getTime(), time); same(result[1].getTime(), time);
  result[0].setTime(21); same(date.getTime(), time); same(result[1].getTime(), 21);
  date.setTime(32); same(result[0].getTime(), 21); same(source[1].getTime(), 32);
}
