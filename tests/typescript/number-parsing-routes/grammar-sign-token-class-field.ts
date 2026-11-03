/*---
description: Repeated, separated and look-alike signs fail numeric grammar after a declared class field read.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-tuples]
---*/
// All four number parsers read a class field; node accepts one adjacent ASCII sign and rejects repeated, separated or Unicode-minus signs before integer, dot and exponent forms.
class SignedText { text: string; constructor(text: string) { this.text = text; } }
function consume(input: SignedText): number[] { const text = input.text; return [parseInt(text), parseFloat(text), Number(text), +text]; }
const signs: [string, boolean][] = [["", true], ["+", true], ["-", true], ["++", false], ["+-", false], ["-+", false], ["--", false], ["+ ", false], ["- ", false], ["+\t", false], ["-\n", false], ["\u2212", false]];
const bodies: [string, number, number][] = [["12", 12, 12], [".5", NaN, 0.5], ["5.", 5, 5], ["1e3", 1, 1000]];
for (const [sign, valid] of signs) for (const [body, integer, decimal] of bodies) {
  const text = sign + body, input = new SignedText(text), factor = sign === "-" ? -1 : 1;
  const expectedInteger = valid ? factor * integer : NaN, expectedDecimal = valid ? factor * decimal : NaN;
  assert.compareArray(consume(input), [expectedInteger, expectedDecimal, expectedDecimal, expectedDecimal], text);
  assert.sameValue(input.text, text);
}
