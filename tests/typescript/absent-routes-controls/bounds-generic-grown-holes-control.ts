/*---
description: Control for bounds-generic-grown-holes; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-generics, ts-interfaces, ts-unions, ts-numbers, ts-strings, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// Dense slot records make every hole explicit; a length guard and per-slot presence flag select each read and the recorded key list.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type BoundsValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 };
const rows: [BoundsValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"], ["", '""'], [NaN, "null"], [false, "false"], [marker, '{"id":7}']];
interface BoundsSlot<T> { present: boolean; value: T | undefined; }
function grow<T>(value: T): BoundsSlot<T>[] { return [{ present: true, value }, { present: false, value: undefined }, { present: true, value: undefined }, { present: false, value: undefined }]; }
function read<T>(xs: BoundsSlot<T>[], index: number): T | undefined { return index >= 0 && index < xs.length && xs[index].present ? xs[index].value : undefined; }
for (const [value, json] of rows) {
  const source = grow(value), keys: string[] = [];
  for (let i = 0; i < source.length; i++) if (source[i].present) keys.push(String(i));
  same(source.length, 4); assert.compareArray(keys, ["0", "2"]);
  same(JSON.stringify(source.map(slot => slot.value)), "[" + json + ",null,null,null]");
  for (const index of [0, 1, 2, 3, 4]) {
    same(read(source, index), index === 0 ? value : undefined);
    same(keys.includes(String(index)), index === 0 || index === 2); same(keys.includes(String(index)), index === 0 || index === 2);
  }
}
