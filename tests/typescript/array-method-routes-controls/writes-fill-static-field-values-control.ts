/*---
description: "Fill writes exact strings NaN signed zero null undefined and object references within an exclusive range through a declared static array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-static, ts-readonly, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localFill<T>(items: T[], value: T, start: number = 0, end: number = items.length): T[] {
  const first = localIndex(start, items.length), last = localIndex(end, items.length);
  for (let i = first; i < last; i++) items[i] = value;
  return items;
}
// Fill writes exact strings NaN signed zero null undefined and object references within an exclusive range; route: a declared static array field.
// Node prints writes-fill-static-field-values:ok.
type Item = number | string | { id: number } | null | undefined;
const marker: { id: number } = { id: 7 };
class FillSource {
  static items: Item[] = [];
  static write(value: Item): Item[] { return localFill(this.items, value, 1, -1); }
}
const values: readonly Item[] = ["text", NaN, -0, null, undefined, marker];
for (const value of values) {
  const input: Item[] = [-0, NaN, null, undefined, marker, "tail"];
  FillSource.items = input;
  const result = FillSource.write(value);
  assert.sameValue(result === input, true);
  assert.compareArray(input, [-0, value, value, value, value, "tail"]);
  assert.sameValue(Object.is(input[0], -0), true);
  if (Object.is(value, -0)) assert.sameValue(Object.is(input[1], -0), true);
}
console.log("writes-fill-static-field-values:ok");
