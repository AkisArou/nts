/*---
description: Explicit conversion and code-unit control for An optional tuple radix applies ToInt32 before selecting the integer digit alphabet.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-tuple-optional, ts-null-undefined]
---*/
// parseInt reads an optional tuple slot; node uses decimal for absent, zero or nonfinite radices, wraps large radices and rejects converted values outside 2 through 36.
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
function consume(input: [string, number?]): number { if (input.length === 1) return scan(input[0]); return scan(input[0], input[1]); }
const radices: [number | undefined, number][] = [
  [undefined, 11], [0, 11], [-0, 11], [1, NaN], [2, 3], [36, 37], [37, NaN], [-1, NaN], [-2, NaN],
  [0.9, 11], [-0.9, 11], [1.9, NaN], [2.9, 3], [-2.9, NaN], [16.9, 17], [36.9, 37], [37.9, NaN],
  [NaN, 11], [Infinity, 11], [-Infinity, 11], [4294967296, 11], [4294967312, 17], [-4294967280, 17],
  [4294967298, 3], [-4294967294, 3], [4294967297, NaN], [4294967295, NaN], [2147483648, NaN], [9007199254740992, 11], [9007199254740994, 3]
];
for (const padding of ["", "\t", "\u00a0"]) for (const sign of ["", "+", "-"]) {
  const text = padding + sign + "11#", factor = sign === "-" ? -1 : 1, missing: [string, number?] = [text];
  assert.sameValue(consume(missing), factor * 11, text); assert.sameValue(missing.length, 1);
  for (const [radix, expected] of radices) {
    const input: [string, number?] = [text, radix];
    assert.sameValue(consume(input), factor * expected, text); assert.sameValue(input[0], text); assert.sameValue(input[1], radix);
  }
}
