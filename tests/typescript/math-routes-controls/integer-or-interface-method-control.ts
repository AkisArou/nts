/*---
description: "Table control for integer-or-interface-method; An interface method reads two numeric receiver fields before bitwise OR and retains the result through a field and array."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-tuples]
---*/
// An interface receiver supplies both OR operands; reads before and after the call plus all stored results are exact. Node independently converts each operand to int32 before combining its bits. The control keeps this route and substitutes position-indexed literal results.
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
  0, -1, 1, -1, 3, -1, -1, -1, 3, -1,
  -1, -1, -1, 1, -1, -1, -1, -1347440721, 3, -3,
  -1, 7, 3, -1, -1, 1, 1, -1, 1, 5,
  -1, -1, -1,
];
interface OrReceiver { left: number; right: number; combine(index: number): number; }
const results: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const source: OrReceiver = { left: inputs[index][0], right: inputs[index][1], combine(position: number): number {
    const left = this.left, right = this.right; same(left, inputs[position][0]); same(right, inputs[position][1]);
    const index = position, result = expected[index]; same(result, expected[index]); return result;
  } };
  const stored: IntegerResult = { value: source.combine(index) };
  same(source.left, inputs[index][0]); same(source.right, inputs[index][1]);
  same(stored.value, expected[index]); results.push(stored.value);
}
assert.compareArray(results, expected);
for (let index = 0; index < results.length; index++) same(results[index], expected[index]);
