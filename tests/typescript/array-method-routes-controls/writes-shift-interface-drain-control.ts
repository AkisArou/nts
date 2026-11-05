/*---
description: "Shift drains each implementation from the front and returns undefined only as specified by values or exhaustion through two interface implementations holding distinct arrays. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

function localShift<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  const value = items[0];
  for (let i = 1; i < items.length; i++) items[i - 1] = items[i];
  items.length = items.length - 1;
  return value;
}
// Shift drains each implementation from the front and returns undefined only as specified by values or exhaustion; route: two interface implementations holding distinct arrays.
// Node prints writes-shift-interface-drain:ok.
type Item = number | string | { id: number } | undefined;
const marker: { id: number } = { id: 8 };
interface Queue { take(): Item | undefined; read(): readonly Item[] }
class NumericQueue implements Queue {
  items: Item[] = [-0, NaN, 3];
  take(): Item | undefined { return localShift(this.items); }
  read(): readonly Item[] { return this.items; }
}
class MixedQueue implements Queue {
  values: Item[] = ["tail", marker, undefined];
  take(): Item | undefined { return localShift(this.values); }
  read(): readonly Item[] { return this.values; }
}
const rows: readonly [Queue, readonly Item[], readonly (readonly Item[])[]][] = [
  [new NumericQueue(), [-0, NaN, 3, undefined], [[NaN, 3], [3], [], []]],
  [new MixedQueue(), ["tail", marker, undefined, undefined], [[marker, undefined], [undefined], [], []]]
];
for (const [queue, expected, remaining] of rows) {
  const result: Item[] = [];
  for (let i = 0; i < expected.length; i++) {
    result[result.length] = queue.take();
    assert.compareArray(queue.read(), remaining[i]);
  }
  assert.compareArray(result, expected);
}
console.log("writes-shift-interface-drain:ok");
