/*---
description: "Parser aliases in a typed tuple preserve global and Number method identity and keep the four parser objects distinct."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-bigint, ts-conversions, ts-type-aliases, ts-unions, ts-tuples, ts-optional-parameters]
---*/
// parseInt and parseFloat aliases plus Number and BigInt cross a typed tuple; node makes Number.parseInt/parseFloat identical to the globals and all four targets distinct.
type Parsed = number | bigint;
type Parser = (text: string, radix?: number) => Parsed;
type NumericParser = (text: string, radix?: number) => number;
type BigParser = (text: string) => bigint;
const integerParser: NumericParser = parseInt, floatParser: NumericParser = parseFloat, numberParser: NumericParser = Number, bigintParser: BigParser = BigInt;
const integerAlias: Parser = Number.parseInt, floatAlias: Parser = Number.parseFloat;
const originals: [Parser, Parser, Parser, Parser] = [integerParser, floatParser, numberParser, bigintParser];
const aliases: [Parser, Parser, Parser, Parser] = [integerAlias, floatAlias, numberParser, bigintParser];
const rows: [string, Parsed[]][] = [["27", [27, 27, 27, 27n]], ["-0", [-0, -0, -0, 0n]]];
for (const [part, expected] of rows) for (let index = 0; index < aliases.length; index++) {
  const text = " " + part + " ";
  assert.sameValue(aliases[index], originals[index]); assert.sameValue(aliases[index](text), expected[index]);
  for (let other = 0; other < originals.length; other++) assert.sameValue(aliases[index] === originals[other], index === other);
}
assert.sameValue(integerAlias, integerParser); assert.sameValue(floatAlias, floatParser);
