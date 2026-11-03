/*---
description: Number accepts complete unsigned nondecimal strings from a readonly tuple and refuses every signed prefix.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-readonly]
---*/
// Number reads a readonly tuple text slot; node accepts unsigned complete x/X, b/B and o/O strings and returns NaN for signs, missing digits or tails.
function consume(input: readonly [string, string]): number { return Number(input[1]); }
const prefixes: [string, number, string, number, string][] = [
  ["0x", 16, "aF", 175, "g"], ["0X", 16, "Ff", 255, "G"], ["0b", 2, "101", 5, "2"],
  ["0B", 2, "110", 6, "2"], ["0o", 8, "77", 63, "8"], ["0O", 8, "71", 57, "8"]
];
for (const [prefix, radix, extra, extraValue, invalidDigit] of prefixes) {
  const digits: [string, number][] = [["10", radix], ["11", radix + 1], ["000", 0], [extra, extraValue], ["", NaN]];
  for (const [body, value] of digits) for (const sign of ["", "+", "-"]) for (const suffix of ["", invalidDigit, "q", "_1", ".0"]) {
    const text = sign + prefix + body + suffix, input: readonly [string, string] = ["numeric", text];
    const expected = sign === "" && suffix === "" ? value : NaN;
    assert.sameValue(consume(input), expected, text); assert.compareArray(input, ["numeric", text]);
  }
}
