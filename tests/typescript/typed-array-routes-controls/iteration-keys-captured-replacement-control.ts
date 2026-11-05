/*---
description: "Keys stay relative indices while a captured binding changes to another array. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-closures, ts-arrow-functions]
---*/

function localUint16Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function* localKeys(data: number[]): IterableIterator<number> { for (let i = 0; i < data.length; i++) yield i; }
// Keys stay relative indices while a captured binding changes to another array. Route: a let binding captured by the iterator factory.
// Node prints iteration-keys-captured-replacement:ok.
type Values = number[];
let current: Values = localUint16Array([10, 20, 30]); const keys = () => localKeys(current);
for (const seed of [[10, 20, 30], [4, 5]]) {
  current = localUint16Array(seed); const seen: number[] = [];
  for (const key of keys()) { seen.push(key); current[key] = key + 7; }
  const expectedKeys: number[] = [], expectedValues: number[] = [], actual: number[] = [];
  for (let i = 0; i < seed.length; i++) { expectedKeys[i] = i; expectedValues[i] = i + 7; actual[i] = current[i]; }
  assert.compareArray(seen, expectedKeys); assert.compareArray(actual, expectedValues);
}
console.log("iteration-keys-captured-replacement:ok");
