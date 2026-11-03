/*---
description: BigInt distinguishes excluded whitespace on both sides through a tuple element.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-type-aliases, ts-bigint, ts-errors]
---*/
// BigInt: tuple-element carries the original text; node throws SyntaxError for each excluded code point, even beside real whitespace.
type TextTuple = [label: string, text: string];
function read(pair: TextTuple): bigint { return BigInt(pair[1]); }
const excluded: string[] = ["\u180e", "\u200b", "\u0085"];
for (const mark of excluded) for (const digits of ["17", "-28", "+35"]) {
  for (const text of [mark + digits, digits + mark, " " + mark + digits + "\t", "\n" + digits + mark + " ", mark, "1" + mark + "2"]) {
    assert.throws(SyntaxError, () => read(["input", text]));
  }
}
