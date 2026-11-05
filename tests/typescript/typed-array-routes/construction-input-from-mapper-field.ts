/*---
description: "From passes each source value and index to its mapper before converting the mapped result."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-class, ts-class-fields, ts-tuples, ts-destructuring, ts-arrow-functions, ts-closures]
---*/

// From passes each source value and index to its mapper before converting the mapped result. Route: a declared mapper callback stored in a field.
// Node prints construction-input-from-mapper-field:ok.
type Mapper = (value: number, index: number) => number;
class MapperStore { run: Mapper; constructor(run: Mapper) { this.run = run; } }
const rows: readonly [readonly number[], readonly number[], readonly number[]][] = [
  [[1, 2, 3], [10, 21, 32], [1, 0, 2, 1, 3, 2]], [[25, 26, -1], [250, 5, 248], [25, 0, 26, 1, -1, 2]], [[], [], []]
];
for (const [values, expected, expectedLog] of rows) {
  const log: number[] = [], store = new MapperStore((value, index) => { log.push(value, index); return value * 10 + index; });
  const result = Uint8Array.from(values, store.run), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.compareArray(log, expectedLog);
}
console.log("construction-input-from-mapper-field:ok");
