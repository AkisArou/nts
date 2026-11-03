/*---
description: "A typed parser array dispatches every stored intrinsic and keeps copied elements after the array order changes."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-bigint, ts-conversions, ts-type-aliases, ts-unions, ts-tuples, ts-errors, ts-optional-parameters]
---*/
// parseInt, parseFloat, Number and BigInt cross Parser array elements; node keeps each copied target and its grammar when the next element replaces its slot.
type Parsed = number | bigint;
type Parser = (text: string, radix?: number) => Parsed;
type NumericParser = (text: string, radix?: number) => number;
type BigParser = (text: string) => bigint;
const integerParser: NumericParser = parseInt, floatParser: NumericParser = parseFloat, numberParser: NumericParser = Number, bigintParser: BigParser = BigInt;
const parsers: Parser[] = [integerParser, floatParser, numberParser, bigintParser];
const rows: [string, (Parsed | undefined)[]][] = [
  ["19", [19, 19, 19, 19n]], ["-0", [-0, -0, -0, 0n]],
  ["-7.25tail", [-7, -7.25, NaN, undefined]], ["+.5", [NaN, 0.5, 0.5, undefined]], ["", [NaN, NaN, 0, 0n]]
];
for (const [part, expected] of rows) {
  const text = " " + part + " ";
  for (let index = 0; index < parsers.length; index++) {
    const retained: Parser = parsers[index], replacement: Parser = parsers[(index + 1) % parsers.length];
    parsers[index] = replacement; assert.sameValue(parsers[index], replacement);
    if (expected[index] === undefined) assert.throws(SyntaxError, () => retained(text)); else assert.sameValue(retained(text), expected[index]);
    parsers[index] = retained;
  }
}
