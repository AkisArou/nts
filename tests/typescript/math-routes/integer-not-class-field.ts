/*---
description: "A declared class number field retains raw input until complement executes and returns through another field and array."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-class, ts-class-fields]
---*/
// A class method complements its declared numeric field while checking the original input and every result. Node applies int32 conversion before NOT and leaves the original field unchanged.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
interface IntegerResult { value: number; }
const inputs: number[] = [
  0, -0, 0.5, -0.5, 1.5, -1.5,
  2.5, -2.5, 1, 2, 3, 255,
  256, 65535, 65536, 2147483647, 2147483648, -2147483649,
  4294967295, 4294967296, 4294967297, -4294967297, 4503599627370496, -4503599627370496,
  9007199254740991, 9007199254740992, 9007199254740994, Number.MIN_VALUE, Number.MAX_VALUE, Infinity,
  -Infinity, NaN,
];
const expected: number[] = [
  -1, -1, -1, -1, -2, 0, -3, 1, -2, -3,
  -4, -256, -257, -65536, -65537, -2147483648, 2147483647, -2147483648, 0, -1,
  -2, 0, -1, -1, 0, -1, -3, -1, -1, -1,
  -1, -1,
];
class ComplementWord {
  value: number;
  constructor(value: number) { this.value = value; }
  complement(index: number): number {
    same(this.value, inputs[index]); const result = ~this.value;
    same(result, expected[index]); return result;
  }
}
const results: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const source = new ComplementWord(inputs[index]), stored: IntegerResult = { value: source.complement(index) };
  same(source.value, inputs[index]);
  same(stored.value, expected[index]); results.push(stored.value);
}
assert.compareArray(results, expected);
for (let index = 0; index < results.length; index++) same(results[index], expected[index]);
