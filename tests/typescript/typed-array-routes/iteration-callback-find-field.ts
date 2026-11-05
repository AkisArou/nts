/*---
description: "Find and findIndex pass exact forward callback arguments and retain the original receiver identity."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-strings, ts-function-types, ts-class, ts-class-fields, ts-this]
---*/

// Find and findIndex pass exact forward callback arguments and retain the original receiver identity. Route: a declared predicate callback field and readonly expectation rows. Node prints iteration-callback-find-field:ok.
type Samples = Int16Array;
type Predicate = (value: number, index: number, owner: Samples) => boolean;
class CallbackHolder { test: Predicate; constructor(test: Predicate) { this.test = test; } }
const rows: readonly [readonly number[], number | undefined, number, readonly (string | number | boolean)[]][] = [
  [[5, -3, 7, -1], -3, 1, ["find", 5, 0, true, "find", -3, 1, true, "index", 5, 0, true, "index", -3, 1, true]],
  [[2, 4], undefined, -1, ["find", 2, 0, true, "find", 4, 1, true, "index", 2, 0, true, "index", 4, 1, true]],
  [[-7], -7, 0, ["find", -7, 0, true, "index", -7, 0, true]], [[], undefined, -1, []]
];
for (const [input, expectedValue, expectedIndex, expectedLog] of rows) {
  const data: Samples = new Int16Array(input), log: (string | number | boolean)[] = []; let phase = "find";
  const holder = new CallbackHolder((value, index, owner) => { log.push(phase, value, index, owner === data); return value < 0; });
  assert.sameValue(data.find(holder.test), expectedValue); phase = "index";
  assert.sameValue(data.findIndex(holder.test), expectedIndex); assert.compareArray(log, expectedLog);
}
console.log("iteration-callback-find-field:ok");
