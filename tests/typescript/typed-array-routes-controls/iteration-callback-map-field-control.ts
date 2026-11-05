/*---
description: "Map calls the stored callback with each value, index and the original receiver, then stores its returned value. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-function-types, ts-class, ts-class-fields, ts-this]
---*/

function localInt16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localMap(data: number[], callback: (value: number, index: number, owner: number[]) => number): number[] { const result: number[] = []; for (let i = 0, length = data.length; i < length; i++) result[i] = callback(data[i], i, data); return result; }
// Map calls the stored callback with each value, index and the original receiver, then stores its returned value. Route: a declared mapper callback field. Node prints iteration-callback-map-field:ok.
type Samples = number[];
type Mapper = (value: number, index: number, owner: Samples) => number;
class CallbackHolder { run: Mapper; constructor(run: Mapper) { this.run = run; } }
const rows: readonly [readonly number[], readonly number[], readonly (number | boolean)[]][] = [
  [[5, 5], [5, 6], [5, 0, true, 5, 1, true]],
  [[-3, 7, 0], [-3, 8, 2], [-3, 0, true, 7, 1, true, 0, 2, true]],
  [[11], [11], [11, 0, true]], [[], [], []]
];
for (const [input, expected, expectedLog] of rows) {
  const data: Samples = localInt16Array(input), log: (number | boolean)[] = [];
  const holder = new CallbackHolder((value, index, owner) => { log.push(value, index, owner === data); return value + index; });
  const result = localMap(data, holder.run), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.compareArray(log, expectedLog);
}
console.log("iteration-callback-map-field:ok");
