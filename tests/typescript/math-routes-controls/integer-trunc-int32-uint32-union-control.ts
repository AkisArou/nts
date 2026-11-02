/*---
description: "Table control for integer-trunc-int32-uint32-union; A number-or-record union supplies the same raw value to truncation, signed conversion and unsigned conversion before exact field and array reads."
features: [ts-math-routes, ts-math-route-integer-conversions, ts-numbers, ts-functions, ts-iteration, ts-arrays, ts-interfaces, ts-objects, ts-typeof-operator, ts-expressions, ts-tuples, ts-type-aliases, ts-unions, ts-narrowing]
---*/
// A number-or-record parameter narrows to its raw numeric payload; three result fields and their array reads are exact. Node preserves wide values and negative zero for trunc, but wraps integer conversions and maps nonfinite inputs to positive zero. The control keeps this route and substitutes position-indexed literal results.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const inputs: number[] = [
  0, -0, 0.5, -0.5, 1.5, -1.5,
  2.5, -2.5, 1, 2, 3, 255,
  256, 65535, 65536, 2147483647, 2147483648, -2147483649,
  4294967295, 4294967296, 4294967297, -4294967297, 4503599627370496, -4503599627370496,
  9007199254740991, 9007199254740992, 9007199254740994, Number.MIN_VALUE, Number.MAX_VALUE, Infinity,
  -Infinity, NaN,
];
const expected: [number, number, number][] = [
  [0, 0, 0], [0, -0, 0], [0, 0, 0], [0, -0, 0],
  [1, 1, 1], [-1, -1, 4294967295], [2, 2, 2], [-2, -2, 4294967294],
  [1, 1, 1], [2, 2, 2], [3, 3, 3], [255, 255, 255],
  [256, 256, 256], [65535, 65535, 65535], [65536, 65536, 65536], [2147483647, 2147483647, 2147483647],
  [-2147483648, 2147483648, 2147483648], [2147483647, -2147483649, 2147483647], [-1, 4294967295, 4294967295], [0, 4294967296, 0],
  [1, 4294967297, 1], [-1, -4294967297, 4294967295], [0, 4503599627370496, 0], [0, -4503599627370496, 0],
  [-1, 9007199254740991, 4294967295], [0, 9007199254740992, 0], [2, 9007199254740994, 2], [0, 0, 0],
  [0, 1.7976931348623157e+308, 0], [0, Infinity, 0], [0, -Infinity, 0], [0, NaN, 0],
];
type NumericSource = number | { value: number };
interface ConvertedValues { signed: number; truncated: number; unsigned: number; }
function convert(source: NumericSource, index: number): ConvertedValues {
  const value = typeof source === "number" ? source : source.value; same(value, inputs[index]);
  const result: ConvertedValues = { signed: expected[index][0], truncated: expected[index][1], unsigned: expected[index][2] };
  same(result.signed, expected[index][0]); same(result.truncated, expected[index][1]); same(result.unsigned, expected[index][2]); return result;
}
for (let index = 0; index < inputs.length; index++) {
  const routes: NumericSource[] = [inputs[index], { value: inputs[index] }];
  for (const source of routes) {
    const stored = convert(source, index), values: number[] = [stored.signed, stored.truncated, stored.unsigned];
    assert.compareArray(values, expected[index]);
    for (let column = 0; column < values.length; column++) same(values[column], expected[index][column]);
    same(typeof source === "number" ? source : source.value, inputs[index]);
  }
}
