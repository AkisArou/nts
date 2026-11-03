/*---
description: Explicit code-unit control for Partial and complete parsers distinguish nonnumeric suffixes from nonnumeric starts in a typed tuple.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples]
---*/
// All four number parsers read one tuple text slot; node preserves valid integer/float prefixes before px, NUL, surrogates and other tails, but whole conversion and invalid starts fail.
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
function consume(input: [string, string]): number[] { const text = input[1]; return [scan(text, 0), scan(text, 1), scan(text, 2), scan(text, 2)]; }
const rows: [string, number, number][] = [["12", 12, 12], ["12.75", 12, 12.75], [".5", NaN, 0.5], ["5.", 5, 5], ["12e3", 12, 12000]];
for (const [body, integer, fraction] of rows) for (const sign of ["", "+", "-"]) for (const tail of ["px", "\u0000", "\u00a0x", "\ud800", "_", "x12"]) {
  const text = sign + body + tail, input: [string, string] = ["numeric", text], factor = sign === "-" ? -1 : 1;
  assert.compareArray(consume(input), [factor * integer, factor * fraction, NaN, NaN], text);
  assert.compareArray(input, ["numeric", text]);
  const invalid: [string, string] = ["numeric", tail + sign + body];
  assert.compareArray(consume(invalid), [NaN, NaN, NaN, NaN], invalid[1]);
}
