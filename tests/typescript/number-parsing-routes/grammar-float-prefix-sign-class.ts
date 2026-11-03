/*---
description: parseFloat stops after the signed initial zero of every nondecimal prefix held in a class field.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-tuples]
---*/
// parseFloat reads a declared class field; node returns zero for every x/X, b/B and o/O form and negative zero after a minus sign.
class PrefixText { text: string; constructor(text: string) { this.text = text; } }
function consume(input: PrefixText): number { return parseFloat(input.text); }
const prefixes: [string, number, string, number, string][] = [
  ["0x", 16, "aF", 175, "g"], ["0X", 16, "Ff", 255, "G"], ["0b", 2, "101", 5, "2"],
  ["0B", 2, "110", 6, "2"], ["0o", 8, "77", 63, "8"], ["0O", 8, "71", 57, "8"]
];
for (const [prefix, radix, extra, extraValue, invalidDigit] of prefixes) {
  const digits: [string, number][] = [["10", radix], ["11", radix + 1], ["000", 0], [extra, extraValue], ["", NaN]];
  for (const [body] of digits) for (const sign of ["", "+", "-"]) for (const suffix of ["", invalidDigit, "q", "_1", ".0"]) {
    const text = sign + prefix + body + suffix, input = new PrefixText(text), expected = sign === "-" ? -0 : 0;
    assert.sameValue(consume(input), expected, text); assert.sameValue(input.text, text);
  }
}
