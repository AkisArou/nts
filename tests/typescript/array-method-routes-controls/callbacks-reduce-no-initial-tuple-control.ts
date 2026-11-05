/*---
description: "reduce takes the first value as accumulator and begins its callback at index one through typed tuples of dense inputs and expected histories. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-tuples, ts-readonly, ts-arrow-functions]
---*/
function localReduce<T>(items: T[], callback: (accumulator: T, value: T, index: number, owner: T[]) => T): T {
  if (items.length === 0) throw new TypeError("empty fold");
  let accumulator = items[0];
  for (let index = 1; index < items.length; index++) accumulator = callback(accumulator, items[index], index, items);
  return accumulator;
}
// reduce takes the first value as accumulator and begins its callback at index one; route: typed tuples of dense inputs and expected histories.
// Node prints: callbacks-reduce-no-initial-tuple:ok
const rows: readonly [number[], number, string[]][] = [
  [[2, 5, 7], 14, ["1:2:5:true", "2:7:7:true"]],
  [[9, -3], 6, ["1:9:-3:true"]],
];
for (const [items, expected, visits] of rows) {
  const log: string[] = [];
  const callback = (sum: number, value: number, index: number, owner: number[]): number => {
    log[log.length] = index + ":" + sum + ":" + value + ":" + (owner === items);
    return sum + value;
  };
  const result = localReduce(items, callback);
  assert.sameValue(result, expected); assert.compareArray(log, visits);
}
console.log("callbacks-reduce-no-initial-tuple:ok");
