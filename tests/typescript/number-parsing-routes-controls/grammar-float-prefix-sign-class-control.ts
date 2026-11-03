/*---
description: Explicit code-unit control for parseFloat stops after the signed initial zero of every nondecimal prefix held in a class field.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-tuples]
---*/
// parseFloat reads a declared class field; node returns zero for every x/X, b/B and o/O form and negative zero after a minus sign.
function white(c: number): boolean {
  return c === 9 || c === 11 || c === 12 || c === 32 || c === 160 || c === 65279 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8239 || c === 8287 || c === 12288 || c === 10 || c === 13 || c === 8232 || c === 8233;
}
function scan(text: string): number {
  let i = 0, sign = 1, value = 0, count = 0;
  while (i < text.length && white(text.charCodeAt(i))) i++;
  if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { if (text.charCodeAt(i) === 45) sign = -1; i++; }
  for (; i < text.length; i++) {
    const digit = text.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) break;
    value = value * 10 + digit; count++;
  }
  return count === 0 ? NaN : sign * value;
}
class PrefixText { text: string; constructor(text: string) { this.text = text; } }
function consume(input: PrefixText): number { return scan(input.text); }
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
