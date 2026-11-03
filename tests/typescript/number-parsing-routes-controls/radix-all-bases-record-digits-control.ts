/*---
description: Explicit conversion and code-unit control for Every radix accepts its highest digit in either case and stops at its first excluded digit through a Record field.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-record, ts-tuples]
---*/
// parseInt reads a Record text field and declared radix; node accumulates two valid digits exactly, stops at the alphabet boundary and returns NaN when that boundary is first.
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
function consume(input: Record<"text", string>, radix: number): number { return scan(input.text, radix); }
const radices: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
const alphabets: string[] = ["0123456789abcdefghijklmnopqrstuvwxyz", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
for (const radix of radices) for (const alphabet of alphabets) for (const sign of ["", "+", "-"]) {
  const highest = alphabet.charAt(radix - 1), excluded = radix === 36 ? "!" : alphabet.charAt(radix), factor = sign === "-" ? -1 : 1;
  const rows: [string, number][] = [[highest + "1" + excluded + "9", (radix - 1) * radix + 1], ["1" + highest + excluded + "9", 2 * radix - 1], [excluded + highest, NaN]];
  for (const [body, expected] of rows) {
    const text = sign + body, input: Record<"text", string> = { text };
    assert.sameValue(consume(input, radix), factor * expected, text); assert.sameValue(input.text, text);
  }
}
