/*---
description: "Four parser values in declared interface fields retain their distinct grammars, zero signs and bigint failures."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-bigint, ts-conversions, ts-type-aliases, ts-unions, ts-interfaces, ts-objects, ts-tuples, ts-errors, ts-optional-parameters]
---*/
// parseInt, parseFloat, Number and BigInt cross callable interface fields; node returns distinct partial/whole values, negative zero, or SyntaxError for the same text.
type Parsed = number | bigint;
type Parser = (text: string, radix?: number) => Parsed;
type NumericParser = (text: string, radix?: number) => number;
type BigParser = (text: string) => bigint;
const integerParser: NumericParser = parseInt, floatParser: NumericParser = parseFloat, numberParser: NumericParser = Number, bigintParser: BigParser = BigInt;
interface ParserFields { integer: Parser; fraction: Parser; whole: Parser; big: Parser; }
const fields: ParserFields = { integer: integerParser, fraction: floatParser, whole: numberParser, big: bigintParser };
const rows: [string, (Parsed | undefined)[]][] = [
  ["19", [19, 19, 19, 19n]], ["-0", [-0, -0, -0, 0n]],
  ["-7.25tail", [-7, -7.25, NaN, undefined]], ["+.5", [NaN, 0.5, 0.5, undefined]], ["", [NaN, NaN, 0, 0n]]
];
for (const [part, expected] of rows) {
  const text = " " + part + " ";
  assert.sameValue(fields.integer(text), expected[0]); assert.sameValue(fields.fraction(text), expected[1]);
  assert.sameValue(fields.whole(text), expected[2]);
  if (expected[3] === undefined) assert.throws(SyntaxError, () => fields.big(text)); else assert.sameValue(fields.big(text), expected[3]);
}
