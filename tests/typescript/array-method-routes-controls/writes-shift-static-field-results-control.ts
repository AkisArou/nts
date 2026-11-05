/*---
description: "Shift returns the first exact value and leaves the expected suffix on empty single and longer arrays through a declared static array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

function localShift<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  const value = items[0];
  for (let i = 1; i < items.length; i++) items[i - 1] = items[i];
  items.length = items.length - 1;
  return value;
}
// Shift returns the first exact value and leaves the expected suffix on empty single and longer arrays; route: a declared static array field.
// Node prints writes-shift-static-field-results:ok.
type Item = number | string | { id: number } | null | undefined;
const marker: { id: number } = { id: 7 };
class ShiftSource {
  static items: Item[] = [];
  static take(): Item | undefined { return localShift(this.items); }
}
const rows: readonly [Item[], Item | undefined, readonly Item[]][] = [[[], undefined, []], [[undefined], undefined, []], [[-0], -0, []], [[null], null, []], [[marker, 1], marker, [1]], [[NaN, -0, marker, "tail"], NaN, [-0, marker, "tail"]]];
for (const [input, expected, remaining] of rows) {
  ShiftSource.items = input;
  const result = ShiftSource.take();
  assert.sameValue(result, expected);
  assert.sameValue(Object.is(result, expected), true);
  assert.compareArray(ShiftSource.items, remaining);
  assert.sameValue(ShiftSource.items === input, true);
}
console.log("writes-shift-static-field-results:ok");
