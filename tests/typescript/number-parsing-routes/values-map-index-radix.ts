/*---
description: "Typed parser callbacks passed to map distinguish its index radix from the extra arguments ignored by the other parsers."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-bigint, ts-conversions, ts-type-aliases, ts-unions, ts-tuples, ts-closures, ts-optional-parameters]
---*/
// parseInt, parseFloat, Number and BigInt cross typed map callbacks; node returns [1, NaN, NaN] for map(parseInt), while other parsers convert every element normally.
type Parsed = number | bigint;
type Parser = (text: string, radix?: number) => Parsed;
type NumericParser = (text: string, radix?: number) => number;
type BigParser = (text: string) => bigint;
const integerParser: NumericParser = parseInt, floatParser: NumericParser = parseFloat, numberParser: NumericParser = Number, bigintParser: BigParser = BigInt;
const parsers: Parser[] = [integerParser, floatParser, numberParser, bigintParser];
const rows: [string[], Parsed[][]][] = [
  [["1", "2", "3"], [[1, NaN, NaN], [1, 2, 3], [1, 2, 3], [1n, 2n, 3n]]],
  [["10", "10", "10", "10", "10"], [[10, NaN, 2, 3, 4], [10, 10, 10, 10, 10], [10, 10, 10, 10, 10], [10n, 10n, 10n, 10n, 10n]]],
  [["-0", "-0", "-0"], [[-0, NaN, -0], [-0, -0, -0], [-0, -0, -0], [0n, 0n, 0n]]]
];
for (const [parts, expected] of rows) {
  const texts: string[] = []; for (const part of parts) texts.push(" " + part + " ");
  for (let index = 0; index < parsers.length; index++) assert.compareArray(texts.map(parsers[index]), expected[index]);
}
