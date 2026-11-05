/*---
description: "Combined array and Set spreads retain operand order and produce a fresh copy for empty and nonempty combinations."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-tuples, ts-map-set, ts-destructuring, ts-spread]
---*/

// Combined array and Set spreads retain operand order and produce a fresh copy for empty and nonempty combinations. Route: readonly tuples carrying an array and a Set. Node prints construction-spread-mixed-readonly-tuple:ok.
const rows: readonly [readonly number[], Set<number>, readonly number[]][] = [
  [[1, 2], new Set([3, 3, 4]), [1, 2, 3, 4]], [[], new Set([4]), [4]],
  [[5], new Set<number>(), [5]], [[], new Set<number>(), []]
];
for (const [array, values, expected] of rows) {
  const count = array.length, setSize = values.size, result = [...array, ...values];
  assert.compareArray(result, expected); assert.sameValue(result === array, false);
  assert.sameValue(array.length, count); assert.sameValue(values.size, setSize);
  for (let i = 0; i < count; i++) assert.sameValue(array[i], expected[i]);
  for (let i = count; i < expected.length; i++) assert.sameValue(values.has(expected[i]), true);
  values.add(99); assert.compareArray(result, expected);
}
console.log("construction-spread-mixed-readonly-tuple:ok");
