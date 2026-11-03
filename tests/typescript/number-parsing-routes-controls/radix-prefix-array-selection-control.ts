/*---
description: Explicit conversion and code-unit control for Explicit radices decide whether x is a prefix marker, an invalid digit or an ordinary digit after a string-array read.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-null-undefined, ts-optional-parameters, ts-readonly]
---*/
// parseInt reads a string-array element; node strips x/X only for inferred or hexadecimal radix, while bases 16, 32 and 36 interpret b/o/x as ordinary eligible digits otherwise.
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
function consume(input: readonly string[], radix?: number): number { return scan(input[1], radix); }
const radices: (number | undefined)[] = [undefined, 0, 16, 10, 32, 36];
const rows: [string, number[]][] = [
  ["0x21", [33, 33, 33, 0, 0, 42841]], ["0X21", [33, 33, 33, 0, 0, 42841]],
  ["0x", [NaN, NaN, NaN, 0, 0, 33]], ["0X", [NaN, NaN, NaN, 0, 0, 33]],
  ["0xg", [NaN, NaN, NaN, 0, 0, 1204]], ["0XG", [NaN, NaN, NaN, 0, 0, 1204]],
  ["0b11", [0, 0, 2833, 0, 11297, 14293]], ["0B11", [0, 0, 2833, 0, 11297, 14293]],
  ["0o11", [0, 0, 0, 0, 24609, 31141]], ["0O11", [0, 0, 0, 0, 24609, 31141]]
];
for (const [body, expected] of rows) for (const sign of ["", "+", "-"]) for (let index = 0; index < radices.length; index++) {
  const text = sign + body, input: string[] = ["sentinel", text], factor = sign === "-" ? -1 : 1;
  assert.sameValue(consume(input, radices[index]), factor * expected[index], text); assert.compareArray(input, ["sentinel", text]);
}
