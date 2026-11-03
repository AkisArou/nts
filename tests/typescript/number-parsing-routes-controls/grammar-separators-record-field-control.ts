/*---
description: Explicit code-unit control for Separators in every decimal component stop partial parsers and invalidate complete numeric conversion from a Record field.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-record, ts-tuples]
---*/
// All four number parsers read a Record text field; node stops before underscores in the significand or exponent and returns NaN for every separated whole string.
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
function consume(input: Record<"text", string>): number[] { const text = input.text; return [scan(text, 0), scan(text, 1), scan(text, 2), scan(text, 2)]; }
const rows: [string, number, number, number][] = [
  ["1_000", 1, 1, NaN], ["_1000", NaN, NaN, NaN], ["10_00", 10, 10, NaN], ["1000_", 1000, 1000, NaN], ["1__000", 1, 1, NaN],
  ["1_.5", 1, 1, NaN], ["1._5", 1, 1, NaN], ["1.2_5", 1, 1.2, NaN], [".5_0", NaN, 0.5, NaN], ["._5", NaN, NaN, NaN],
  ["1e_3", 1, 1, NaN], ["1e+_3", 1, 1, NaN], ["1e3_0", 1, 1000, NaN], ["1000", 1000, 1000, 1000], ["1.25", 1, 1.25, 1.25]
];
for (const [body, integer, fraction, whole] of rows) for (const sign of ["", "+", "-"]) {
  const text = sign + body, input: Record<"text", string> = { text }, factor = sign === "-" ? -1 : 1;
  assert.compareArray(consume(input), [factor * integer, factor * fraction, factor * whole, factor * whole], text);
  assert.sameValue(input.text, text);
}
