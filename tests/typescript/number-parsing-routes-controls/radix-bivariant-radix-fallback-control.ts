/*---
description: Explicit conversion and code-unit control for A radix object falls back from valueOf to an integer string before ToInt32 selects its alphabet.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance, ts-typeof-operator]
---*/
// parseInt crosses a widened method interface; node converts text first, then falls back from radix.valueOf to radix.toString and wraps the resulting numeric value.
function white(c: number): boolean { return c === 9 || c === 11 || c === 12 || c === 32 || c === 160 || c === 65279 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8239 || c === 8287 || c === 12288 || c === 10 || c === 13 || c === 8232 || c === 8233;
}
function int32(value: number | undefined): number {
  if (value === undefined || value !== value || value === Infinity || value === -Infinity) return 0;
  let result = (value - value % 1) % 4294967296; if (result < 0) result += 4294967296;
  return result >= 2147483648 ? result - 4294967296 : result;
}
function scan(text: string, raw?: number): number {
  let i = 0, sign = 1, value = 0, count = 0;
  while (i < text.length && white(text.charCodeAt(i))) i++;
  if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { if (text.charCodeAt(i) === 45) sign = -1; i++; }
  let radix = int32(raw); const strip = radix === 0 || radix === 16;
  if (radix !== 0 && (radix < 2 || radix > 36)) return NaN;
  if (radix === 0) radix = 10;
  if (strip && text.charCodeAt(i) === 48 && (text.charCodeAt(i + 1) === 120 || text.charCodeAt(i + 1) === 88)) { radix = 16; i += 2; }
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i), digit = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 90 ? c - 55 : c >= 97 && c <= 122 ? c - 87 : -1;
    if (digit < 0 || digit >= radix) break; value = value * radix + digit; count++;
  }
  return count === 0 ? NaN : sign * value;
}
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
function radixText(text: string): number {
  let value = 0, i = 0, sign = 1; if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { if (text.charCodeAt(i) === 45) sign = -1; i++; }
  for (; i < text.length; i++) { const d = text.charCodeAt(i) - 48; if (d < 0 || d > 9) return NaN; value = value * 10 + d; }
  return sign * value; }
function manual(input: string | TextValue, base: number | RadixValue): number {
  const text = typeof input === "string" ? input : input.toString(); if (typeof text !== "string") throw new TypeError();
  let radix: unknown = typeof base === "number" ? base : base.valueOf(); if (typeof radix !== "number" && typeof base !== "number") radix = base.toString();
  if (typeof radix === "string") radix = radixText(radix); if (typeof radix !== "number") throw new TypeError(); return scan(text, radix);
}
const narrow: Parser<string, number> = { parse: manual }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
const log: string[] = [], rows: [string, number, number][] = [["0", 0, 11], ["2", 2, 3], ["16", 16, 17], ["36", 36, 37], ["37", 37, NaN], ["4294967312", 4294967312, 17], ["-4294967280", -4294967280, 17]];
for (const [digits, selected, expected] of rows) for (const fallback of [false, true]) {
  log.length = 0; const text = "-11#";
  const input: TextValue = { toString(): unknown { log.push("text.toString"); return text; }, valueOf(): unknown { log.push("text.valueOf"); return "99"; } };
  const radix: RadixValue = {
    valueOf(): unknown { log.push("radix.valueOf"); return fallback ? {} : selected; },
    toString(): unknown { log.push("radix.toString"); return digits; } };
  assert.sameValue(parser.parse(input, radix), -expected, digits);
  assert.compareArray(log, fallback ? ["text.toString", "radix.valueOf", "radix.toString"] : ["text.toString", "radix.valueOf"]);
}
