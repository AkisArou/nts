/*---
description: "Two constrained generic record shapes preserve raw numbers before leading-zero count results cross fields and an array."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-generics, ts-generic-constraints, ts-readonly, ts-strings]
---*/
// Two generic instantiations read a readonly numeric payload before Math.clz32; raw inputs and both retained count results are exact. Node counts leading zeros after uint32 conversion, including 32 for converted zero.
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
  32, 32, 32, 32, 31, 0, 30, 0, 31, 30,
  30, 24, 23, 16, 15, 1, 0, 1, 0, 32,
  31, 0, 32, 32, 0, 32, 30, 32, 32, 32,
  32, 32,
];
interface CountInput { readonly value: number; }
interface TaggedCountInput { readonly value: number; tag: string; }
function count<T extends CountInput>(source: T, index: number): number {
  same(source.value, inputs[index]); const result = Math.clz32(source.value);
  same(result, expected[index]); return result;
}
const results: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const plain: CountInput = { value: inputs[index] }, tagged: TaggedCountInput = { value: inputs[index], tag: "kept" };
  const first: IntegerResult = { value: count(plain, index) }, second: IntegerResult = { value: count(tagged, index) };
  same(first.value, expected[index]); same(second.value, expected[index]); results.push(first.value, second.value);
  same(plain.value, inputs[index]); same(tagged.value, inputs[index]); assert.sameValue(tagged.tag, "kept");
}
same(results.length, inputs.length * 2);
for (let index = 0; index < inputs.length; index++) { same(results[index * 2], expected[index]); same(results[index * 2 + 1], expected[index]); }
