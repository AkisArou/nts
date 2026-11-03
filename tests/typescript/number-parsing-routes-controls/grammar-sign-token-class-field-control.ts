/*---
description: Explicit code-unit control for Repeated, separated and look-alike signs fail numeric grammar after a declared class field read.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-tuples]
---*/
// All four number parsers read a class field; node accepts one adjacent ASCII sign and rejects repeated, separated or Unicode-minus signs before integer, dot and exponent forms.
function white(c: number): boolean {
  return c === 9 || c === 11 || c === 12 || c === 32 || c === 160 || c === 65279 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8239 || c === 8287 || c === 12288 || c === 10 || c === 13 || c === 8232 || c === 8233;
}
function scan(text: string, mode: number): number {
  let i = 0, end = text.length, sign = 1, value = 0, divisor = 1, count = 0;
  while (i < end && white(text.charCodeAt(i))) i++;
  if (mode === 2) while (end > i && white(text.charCodeAt(end - 1))) end--;
  if (i === end) return mode === 2 ? 0 : NaN;
  if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { if (text.charCodeAt(i) === 45) sign = -1; i++; }
  while (i < end) { const d = text.charCodeAt(i) - 48; if (d < 0 || d > 9) break; value = value * 10 + d; count++; i++; }
  if (mode !== 0 && text.charCodeAt(i) === 46) {
    i++; while (i < end) { const d = text.charCodeAt(i) - 48; if (d < 0 || d > 9) break; value = value * 10 + d; divisor *= 10; count++; i++; }
  }
  if (count === 0) return NaN;
  if (mode !== 0 && (text.charCodeAt(i) === 101 || text.charCodeAt(i) === 69)) {
    const marker = i++; let exponent = 0, negative = false;
    if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { negative = text.charCodeAt(i) === 45; i++; }
    const first = i;
    while (i < end) { const d = text.charCodeAt(i) - 48; if (d < 0 || d > 9) break; exponent = exponent * 10 + d; i++; }
    if (i === first) i = marker;
    else { let power = 1; for (let j = 0; j < exponent; j++) power *= 10; if (negative) divisor *= power; else value *= power; }
  }
  if (mode === 2 && i !== end) return NaN;
  return sign * (value / divisor);
}
class SignedText { text: string; constructor(text: string) { this.text = text; } }
function consume(input: SignedText): number[] { const text = input.text; return [scan(text, 0), scan(text, 1), scan(text, 2), scan(text, 2)]; }
const signs: [string, boolean][] = [["", true], ["+", true], ["-", true], ["++", false], ["+-", false], ["-+", false], ["--", false], ["+ ", false], ["- ", false], ["+\t", false], ["-\n", false], ["\u2212", false]];
const bodies: [string, number, number][] = [["12", 12, 12], [".5", NaN, 0.5], ["5.", 5, 5], ["1e3", 1, 1000]];
for (const [sign, valid] of signs) for (const [body, integer, decimal] of bodies) {
  const text = sign + body, input = new SignedText(text), factor = sign === "-" ? -1 : 1;
  const expectedInteger = valid ? factor * integer : NaN, expectedDecimal = valid ? factor * decimal : NaN;
  assert.compareArray(consume(input), [expectedInteger, expectedDecimal, expectedDecimal, expectedDecimal], text);
  assert.sameValue(input.text, text);
}
