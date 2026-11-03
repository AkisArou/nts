/*---
description: Inferred parseInt reads the sign before hexadecimal prefix detection through a Record parameter.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-record, ts-tuples]
---*/
// parseInt reads a Record text field; node strips only x/X prefixes, preserves the sign and stops before q, underscore or dot.
function consume(input: Record<"text", string>): number { return parseInt(input.text); }
const prefixes: [string, number, string, number, string][] = [
  ["0x", 16, "aF", 175, "g"], ["0X", 16, "Ff", 255, "G"], ["0b", 2, "101", 5, "2"],
  ["0B", 2, "110", 6, "2"], ["0o", 8, "77", 63, "8"], ["0O", 8, "71", 57, "8"]
];
for (const [prefix, radix, extra, extraValue, invalidDigit] of prefixes) {
  const digits: [string, number][] = [["10", radix], ["11", radix + 1], ["000", 0], [extra, extraValue], ["", NaN]];
  for (const [body, value] of digits) for (const sign of ["", "+", "-"]) for (const suffix of ["", invalidDigit, "q", "_1", ".0"]) {
    const text = sign + prefix + body + suffix, input: Record<"text", string> = { text };
    const magnitude = radix === 16 ? value : 0, expected = sign === "-" ? -magnitude : magnitude;
    assert.sameValue(consume(input), expected, text); assert.sameValue(input.text, text);
  }
}
