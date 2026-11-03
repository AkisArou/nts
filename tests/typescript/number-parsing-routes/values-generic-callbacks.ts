/*---
description: "A generic callback parameter calls all four parser values while retaining distinct number and bigint result types."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-bigint, ts-conversions, ts-type-aliases, ts-unions, ts-generics, ts-tuples, ts-errors, ts-optional-parameters]
---*/
// parseInt, parseFloat, Number and BigInt cross an instantiated generic callback parameter; node preserves partial decimals, NaN, signed zero and exact bigint or SyntaxError.
type Parsed = number | bigint;
type Parser = (text: string, radix?: number) => Parsed;
type NumericParser = (text: string, radix?: number) => number;
type BigParser = (text: string) => bigint;
const integerParser: NumericParser = parseInt, floatParser: NumericParser = parseFloat, numberParser: NumericParser = Number, bigintParser: BigParser = BigInt;
function invoke<T>(parser: (text: string) => T, text: string): T { return parser(text); }
const rows: [string, (Parsed | undefined)[]][] = [
  ["19", [19, 19, 19, 19n]], ["-0", [-0, -0, -0, 0n]],
  ["-7.25tail", [-7, -7.25, NaN, undefined]], ["+.5", [NaN, 0.5, 0.5, undefined]], ["", [NaN, NaN, 0, 0n]]
];
for (const [part, expected] of rows) {
  const text = " " + part + " ";
  assert.sameValue(invoke(integerParser, text), expected[0]); assert.sameValue(invoke(floatParser, text), expected[1]);
  assert.sameValue(invoke(numberParser, text), expected[2]);
  if (expected[3] === undefined) assert.throws(SyntaxError, () => invoke(bigintParser, text)); else assert.sameValue(invoke(bigintParser, text), expected[3]);
}
