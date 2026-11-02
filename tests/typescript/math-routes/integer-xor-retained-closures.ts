/*---
description: "Retained typed closures keep two numeric parameters until XOR executes, then preserve every result through a field and array."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-tuples, ts-function-types, ts-type-aliases, ts-closures, ts-arrow-functions]
---*/
// Typed closures capture both XOR operands and their input position, then run after all closures exist. Node preserves each captured pair and its signed int32 XOR result through later storage.
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
  0, -1, 1, -1, 3, 1, -3, -1, 3, -2,
  -1, -1, 0, 1, -2, -1, -1, -1515870811, 3, -3,
  -6, 7, 1, -1, -1, 1, 1, -1, 1, 5,
  -1, -1, -1,
];
type DeferredInteger = () => number;
function retain(left: number, right: number, index: number): DeferredInteger {
  return (): number => {
    same(left, inputs[index][0]); same(right, inputs[index][1]);
    const result = left ^ right; same(result, expected[index]); return result;
  };
}
const pending: DeferredInteger[] = [], results: number[] = [];
for (let index = 0; index < inputs.length; index++) pending.push(retain(inputs[index][0], inputs[index][1], index));
same(pending.length, inputs.length);
for (let index = 0; index < pending.length; index++) {
  const stored: IntegerResult = { value: pending[index]() };
  same(stored.value, expected[index]); results.push(stored.value);
}
assert.compareArray(results, expected);
for (let index = 0; index < results.length; index++) same(results[index], expected[index]);
