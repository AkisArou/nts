/*---
description: "Filter passes every value, index and original receiver to its private predicate and keeps the selected values in order. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-function-types, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

function localInt8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFilter(data: number[], callback: (value: number, index: number, owner: number[]) => boolean): number[] { const result: number[] = []; for (let i = 0, length = data.length; i < length; i++) { const value = data[i]; if (callback(value, i, data)) result[result.length] = value; } return result; }
// Filter passes every value, index and original receiver to its private predicate and keeps the selected values in order. Route: a private typed predicate field. Node prints iteration-callback-filter-private:ok.
type Samples = number[];
type Predicate = (value: number, index: number, owner: Samples) => boolean;
class CallbackHolder {
  #test: Predicate; constructor(test: Predicate) { this.#test = test; }
  select(data: Samples): Samples { return localFilter(data, this.#test); }
}
const rows: readonly [readonly number[], number, readonly number[], readonly (number | boolean)[]][] = [
  [[3, 8, 1, 6], 4, [8, 6], [3, 0, true, 8, 1, true, 1, 2, true, 6, 3, true]],
  [[-1, 2, -3, 4], 0, [2, 4], [-1, 0, true, 2, 1, true, -3, 2, true, 4, 3, true]],
  [[1, 2], 9, [], [1, 0, true, 2, 1, true]], [[], 0, [], []]
];
for (const [input, limit, expected, expectedLog] of rows) {
  const data: Samples = localInt8Array(input), log: (number | boolean)[] = [];
  const holder = new CallbackHolder((value, index, owner) => { log.push(value, index, owner === data); return value > limit; });
  const result = holder.select(data), actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.compareArray(log, expectedLog);
}
console.log("iteration-callback-filter-private:ok");
