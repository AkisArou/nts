/*---
description: A handwritten memoized copy controls A Date field preserves valid and invalid time values in an independent Date.
features: [ts-structuredclone-route-collections, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-interfaces, ts-numbers, ts-map-set]
---*/
// A Date-typed interface field carries epoch, negative, boundary and invalid times; node creates an independent Date with the same time value.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface DateHolder { value: Date; }
function copyDate(source: Date, memory = new Map<Date, Date>()): Date {
  const old = memory.get(source); if (old !== undefined) return old;
  const result = new Date(source.getTime()); memory.set(source, result); return result;
}
for (const time of [0, -0, -86400000, 8640000000000000, NaN]) {
  const holder: DateHolder = { value: new Date(time) }, source = holder.value, expected = source.getTime();
  const result = copyDate(holder.value); fresh(result, source, Date.prototype, []); same(result.getTime(), expected);
  result.setTime(1); same(source.getTime(), expected); source.setTime(2); same(result.getTime(), 1);
}
