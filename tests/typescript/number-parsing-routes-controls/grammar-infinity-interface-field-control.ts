/*---
description: Explicit code-unit control for The four number parsers distinguish the exact Infinity word and its tails through one interface field.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-interfaces, ts-objects, ts-tuples]
---*/
// parseInt, parseFloat, Number and unary plus read one interface field; node rejects Infinity for integers, takes its float prefix and requires the whole word for conversion.
function white(c: number): boolean {
  return c === 9 || c === 11 || c === 12 || c === 32 || c === 160 || c === 65279 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8239 || c === 8287 || c === 12288 || c === 10 || c === 13 || c === 8232 || c === 8233;
}
function scan(text: string, mode: number): number {
  let i = 0, end = text.length, sign = 1, value = 0, count = 0;
  while (i < end && white(text.charCodeAt(i))) i++;
  if (mode === 2) while (end > i && white(text.charCodeAt(end - 1))) end--;
  if (i === end) return mode === 2 ? 0 : NaN;
  if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { if (text.charCodeAt(i) === 45) sign = -1; i++; }
  const word = "Infinity"; let matched = 0;
  while (matched < word.length && i + matched < end && text.charCodeAt(i + matched) === word.charCodeAt(matched)) matched++;
  if (mode !== 0 && matched === word.length) return mode === 2 && i + matched !== end ? NaN : sign * Infinity;
  while (i < end) { const d = text.charCodeAt(i) - 48; if (d < 0 || d > 9) break; value = value * 10 + d; count++; i++; }
  return count === 0 || (mode === 2 && i !== end) ? NaN : sign * value;
}
interface SpecialText { text: string; }
function consume(input: SpecialText): number[] { const text = input.text; return [scan(text, 0), scan(text, 1), scan(text, 2), scan(text, 2)]; }
const rows: [string, number, number, number][] = [
  ["Infinity", NaN, Infinity, Infinity], ["Infinity0", NaN, Infinity, NaN], ["Infinitye-2", NaN, Infinity, NaN],
  ["Infinity_", NaN, Infinity, NaN], ["Infinity.0", NaN, Infinity, NaN], ["Infinity+1", NaN, Infinity, NaN],
  ["infinity", NaN, NaN, NaN], ["INFINITY", NaN, NaN, NaN], ["InfinitY", NaN, NaN, NaN],
  ["Inf", NaN, NaN, NaN], ["NaN", NaN, NaN, NaN], ["\u221e", NaN, NaN, NaN], ["7", 7, 7, 7], ["12", 12, 12, 12]
];
for (const [body, integer, fraction, whole] of rows) for (const sign of ["", "+", "-"]) {
  const text = sign + body, input: SpecialText = { text }, factor = sign === "-" ? -1 : 1;
  assert.compareArray(consume(input), [factor * integer, factor * fraction, factor * whole, factor * whole], text);
  assert.sameValue(input.text, text);
}
