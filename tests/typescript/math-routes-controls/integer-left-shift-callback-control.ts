/*---
description: "Table control for integer-left-shift-callback; A stored typed callback reads both numeric operands before left shift masks its count and stores the result."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-tuples, ts-function-types, ts-arrow-functions]
---*/
// A function-typed field receives the left value and shift count; both are exact before shifting and all results survive field/array storage. Node truncates and masks counts modulo 32. The control keeps this route and substitutes position-indexed literal results.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
interface IntegerResult { value: number; }
const inputs: [number, number][] = [
  [0, 0], [-0, -0], [0.5, 1], [-0.5, -1],
  [1.5, 1.5], [-1.5, -1.5], [2.5, 31], [-2.5, 32],
  [1, 0], [1, 31], [1, 32], [1, 33],
  [1, -1], [1, -32], [1, -33], [-1, 0],
  [-1, 1], [-1, 31], [-1, 32], [-1, 33],
  [-1, -1], [2147483647, 1], [2147483648, 1], [-2147483649, 1],
  [4294967297, 0], [-4294967297, 1], [4503599627370496, 5], [-4503599627370496, -5],
  [9007199254740991, 32], [9007199254740992, 33], [9007199254740994, 1], [Number.MIN_VALUE, Number.MAX_VALUE],
  [Number.MAX_VALUE, Number.MIN_VALUE], [NaN, 5], [Infinity, 33], [-Infinity, -33],
  [2147483648, NaN], [2147483648, Infinity], [2147483648, -Infinity], [3, 4294967297],
  [3, -4294967297], [3, 4294967327], [3, -4294967329], [3, 0.5],
  [3, -0.5],
];
const expected: number[] = [
  0, 0, 0, 0, 2, -2147483648, 0, -2, 1, -2147483648,
  1, 2, -2147483648, 1, -2147483648, -1, -2, -2147483648, -1, -2,
  -2147483648, -2, 0, -2, 1, -2, 0, 0, -1, 0,
  4, 0, 0, 0, 0, 0, -2147483648, -2147483648, -2147483648, 6,
  -2147483648, -2147483648, -2147483648, 3, 3,
];
interface LeftShiftRoute { apply: (left: number, count: number, index: number) => number; }
const route: LeftShiftRoute = { apply: (left, count, index) => {
  same(left, inputs[index][0]); same(count, inputs[index][1]);
  const result = expected[index]; same(result, expected[index]); return result;
} };
const results: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const stored: IntegerResult = { value: route.apply(inputs[index][0], inputs[index][1], index) };
  same(stored.value, expected[index]); results.push(stored.value);
}
assert.compareArray(results, expected);
for (let index = 0; index < results.length; index++) same(results[index], expected[index]);
