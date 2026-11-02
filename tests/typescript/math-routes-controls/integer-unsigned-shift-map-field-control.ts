/*---
description: "Table control for integer-unsigned-shift-map-field; A typed Map value retains two numeric fields until unsigned right shift yields a wide unsigned result through field and array storage."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-tuples, ts-map-set, ts-narrowing]
---*/
// Map values expose raw numeric fields before unsigned right shift; all source and stored result values are exact. Node zero-fills the uint32 value and preserves unsigned results above int32. The control keeps this route and substitutes position-indexed literal results.
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
  0, 0, 0, 0, 0, 1, 0, 4294967294, 1, 0,
  1, 0, 0, 1, 0, 4294967295, 2147483647, 1, 4294967295, 2147483647,
  1, 1073741823, 1073741824, 1073741823, 1, 2147483647, 0, 0, 4294967295, 0,
  1, 0, 0, 0, 0, 0, 2147483648, 2147483648, 2147483648, 1,
  0, 0, 0, 3, 3,
];
interface UnsignedInput { left: number; count: number; }
const pool: Map<number, UnsignedInput> = new Map(), results: number[] = [];
for (let index = 0; index < inputs.length; index++) pool.set(index, { left: inputs[index][0], count: inputs[index][1] });
same(pool.size, inputs.length);
for (let index = 0; index < inputs.length; index++) {
  const source = pool.get(index); if (source === undefined) throw new Error("missing operand");
  same(source.left, inputs[index][0]); same(source.count, inputs[index][1]);
  const result = expected[index]; same(result, expected[index]);
  const stored: IntegerResult = { value: result }; same(source.left, inputs[index][0]); same(source.count, inputs[index][1]);
  same(stored.value, expected[index]); results.push(stored.value);
}
assert.compareArray(results, expected);
for (let index = 0; index < results.length; index++) same(results[index], expected[index]);
