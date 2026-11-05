/*---
description: "Keys stay relative indices while a captured binding changes to another array."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-closures, ts-arrow-functions]
---*/

// Keys stay relative indices while a captured binding changes to another array. Route: a let binding captured by the iterator factory.
// Node prints iteration-keys-captured-replacement:ok.
type Values = Uint16Array;
let current: Values = new Uint16Array([10, 20, 30]); const keys = () => current.keys();
for (const seed of [[10, 20, 30], [4, 5]]) {
  current = new Uint16Array(seed); const seen: number[] = [];
  for (const key of keys()) { seen.push(key); current[key] = key + 7; }
  const expectedKeys: number[] = [], expectedValues: number[] = [], actual: number[] = [];
  for (let i = 0; i < seed.length; i++) { expectedKeys[i] = i; expectedValues[i] = i + 7; actual[i] = current[i]; }
  assert.compareArray(seen, expectedKeys); assert.compareArray(actual, expectedValues);
}
console.log("iteration-keys-captured-replacement:ok");
