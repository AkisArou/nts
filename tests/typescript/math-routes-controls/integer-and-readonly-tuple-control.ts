/*---
description: "Table control for integer-and-readonly-tuple; A readonly numeric tuple parameter supplies both AND operands before exact results cross a return, field and array."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-tuples, ts-readonly, ts-type-aliases]
---*/
// A readonly tuple parameter carries independent AND operands; input slots and every stored result are checked. Node converts each operand to int32 before intersecting the bits. The control keeps this route and substitutes position-indexed literal results.
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
  [-1, -Infinity],
];
const expected: number[] = [
  0, 0, 0, 0, 0, -2, 2, 0, 0, 1,
  0, 0, -1, 0, 1, 0, 0, 168430090, 0, 0,
  5, 0, 2, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0,
];
type AndOperands = readonly [number, number];
function intersect(operands: AndOperands, index: number): number {
  same(operands[0], inputs[index][0]); same(operands[1], inputs[index][1]);
  const result = expected[index]; same(result, expected[index]); return result;
}
const results: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const operands: AndOperands = [inputs[index][0], inputs[index][1]], stored: IntegerResult = { value: intersect(operands, index) };
  same(operands[0], inputs[index][0]); same(operands[1], inputs[index][1]);
  same(stored.value, expected[index]); results.push(stored.value);
}
assert.compareArray(results, expected);
for (let index = 0; index < results.length; index++) same(results[index], expected[index]);
