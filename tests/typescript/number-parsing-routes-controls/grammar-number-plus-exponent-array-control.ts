/*---
description: Explicit code-unit control for Number and unary plus require complete exponent grammar from a declared string-array element.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-readonly, ts-tuples]
---*/
// Number and unary plus read the same typed array element; node accepts complete dot/exponent strings and rejects an incomplete exponent or trailing punctuation.
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
function consume(input: readonly string[]): number[] { const text = input[1]; return [scan(text, 2), scan(text, 2)]; }
const mantissas: [string, number, number][] = [["1", 1, 1], [".5", 5, 10], ["5.", 5, 1], ["12.5", 125, 10], [".", NaN, 1]];
const exponents: [string, number, number, boolean][] = [
  ["", 1, 1, true], ["e3", 1000, 1, true], ["E+3", 1000, 1, true], ["e-3", 1, 1000, true], ["E-0003", 1, 1000, true],
  ["e", 1, 1, false], ["e+", 1, 1, false], ["E-", 1, 1, false], ["e+z", 1, 1, false], ["e-_9", 1, 1, false],
  ["e+2_3", 100, 1, false], ["e+2.5", 100, 1, false], ["e+2e4", 100, 1, false]
];
for (const [body, integer, scale] of mantissas) for (const [exponent, numerator, denominator, valid] of exponents) for (const sign of ["", "+", "-"]) {
  const text = sign + body + exponent, input: string[] = ["sentinel", text, "tail"], factor = sign === "-" ? -1 : 1;
  const expected = valid ? factor * (integer * numerator / (scale * denominator)) : NaN;
  assert.compareArray(consume(input), [expected, expected], text); assert.compareArray(input, ["sentinel", text, "tail"]);
}
