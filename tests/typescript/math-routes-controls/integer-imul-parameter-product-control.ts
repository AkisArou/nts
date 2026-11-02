/*---
description: "Table control for integer-imul-parameter-product; Two declared number parameters retain both operands before exact low-word multiplication crosses a return, field and array."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-tuples]
---*/
// Number parameters supply Math.imul; every operand, immediate result, returned field and retained array element is checked. Node truncates each input to uint32 and returns the signed low product. The control keeps this route and substitutes position-indexed literal results.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
interface IntegerResult { value: number; }
const inputs: [number, number][] = [
  [0, -0], [-0, -1], [0.5, 1.5], [-0.5, -1.5],
  [1.5, 2.5], [-1.5, -2.5], [2.5, -1.5], [-2.5, 1.5],
  [1, 2], [-1, 1], [2147483647, 2147483648], [2147483648, -2147483649],
  [4294967295, 4294967295], [4294967297, 4294967296], [4294967297.75, -4294967297.75], [-2147483649.75, 2147483648.75],
  [1431655765, 2863311530], [2863311530, 252645135], [4503599627370496, 3], [-4503599627370496, -3],
  [9007199254740991, 5], [9007199254740992, 7], [9007199254740994, 3], [Number.MIN_VALUE, -1],
  [-1, Number.MIN_VALUE], [Number.MAX_VALUE, 1], [1, Number.MAX_VALUE], [NaN, -1],
  [1, NaN], [Infinity, 5], [4294967295, Infinity], [-Infinity, -1],
  [-1, -Infinity], [65537, 65537], [2147483647, 2147483647], [2147483648, -1],
  [-2147483648, -1], [4294967295, 4294967293], [1.9, -2.9],
];
const expected: number[] = [
  0, 0, 0, 0, 2, 2, -2, -2, 2, -1,
  -2147483648, -2147483648, 1, 0, -1, -2147483648, 1908874354, -168430090, 0, 0,
  -5, 0, 6, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 131073, 1, -2147483648, -2147483648, 3, -2,
];
function multiply(left: number, right: number, index: number): number {
  same(left, inputs[index][0]); same(right, inputs[index][1]);
  const result = expected[index]; same(result, expected[index]); return result;
}
const results: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const stored: IntegerResult = { value: multiply(inputs[index][0], inputs[index][1], index) };
  same(stored.value, expected[index]); results.push(stored.value);
}
assert.compareArray(results, expected);
for (let index = 0; index < results.length; index++) same(results[index], expected[index]);
