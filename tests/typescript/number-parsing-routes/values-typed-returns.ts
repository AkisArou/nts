/*---
description: "A declared parser return selects each intrinsic at runtime and preserves its identity and later parsing behavior."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-bigint, ts-conversions, ts-type-aliases, ts-unions, ts-tuples, ts-errors, ts-optional-parameters]
---*/
// parseInt, parseFloat, Number and BigInt cross a Parser return; node calls the selected target and keeps its identity even after another target is returned.
type Parsed = number | bigint;
type Parser = (text: string, radix?: number) => Parsed;
type NumericParser = (text: string, radix?: number) => number;
type BigParser = (text: string) => bigint;
const integerParser: NumericParser = parseInt, floatParser: NumericParser = parseFloat, numberParser: NumericParser = Number, bigintParser: BigParser = BigInt;
function choose(index: number): Parser {
  if (index === 0) return integerParser; if (index === 1) return floatParser; if (index === 2) return numberParser; return bigintParser;
}
const originals: Parser[] = [integerParser, floatParser, numberParser, bigintParser];
const rows: [string, (Parsed | undefined)[]][] = [
  ["19", [19, 19, 19, 19n]], ["-0", [-0, -0, -0, 0n]],
  ["-7.25tail", [-7, -7.25, NaN, undefined]], ["+.5", [NaN, 0.5, 0.5, undefined]], ["", [NaN, NaN, 0, 0n]]
];
for (const [part, expected] of rows) for (let index = 0; index < originals.length; index++) {
  const text = " " + part + " ", parser: Parser = choose(index);
  assert.sameValue(parser, originals[index]); assert.notSameValue(choose((index + 1) % originals.length), parser);
  if (expected[index] === undefined) assert.throws(SyntaxError, () => parser(text)); else assert.sameValue(parser(text), expected[index]);
}
