/*---
description: "every preserves callback arguments and stops on the first false result through a readonly list of typed predicates."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-readonly, ts-tuples, ts-function-types, ts-arrow-functions]
---*/
// every preserves callback arguments and stops on the first false result; route: a readonly list of typed predicates.
// Node prints: callbacks-every-readonly-operations:ok
const items: number[] = [3, 8, 14], log: string[] = [];
type EveryRule = (value: number, index: number, owner: number[]) => boolean;
function record(value: number, index: number, owner: number[]): void {
  log[log.length] = index + ":" + value + ":" + (owner === items);
}
const rows: readonly [EveryRule, boolean, string[]][] = [
  [(value, index, owner) => { record(value, index, owner); return value < 8; }, false, ["0:3:true", "1:8:true"]],
  [(value, index, owner) => { record(value, index, owner); return value > 0; }, true, ["0:3:true", "1:8:true", "2:14:true"]],
];
for (const [callback, expected, visits] of rows) {
  log.length = 0;
  const result = items.every(callback);
  assert.sameValue(result, expected); assert.compareArray(log, visits);
  assert.compareArray(items, [3, 8, 14]);
}
console.log("callbacks-every-readonly-operations:ok");
