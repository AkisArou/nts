/*---
description: Explicit digit-loop control for parseInt reaches the finite and infinite binary64 boundary through declared class fields.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-bigint]
---*/
// Control: parseInt: class fields carry binary digits and their radix; node returns 2^1023 and the largest finite number, then rounds the halfway overflow and 2^1024 to infinity.
function space(code: number): boolean { return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233; }
function rounded(value: bigint): number {
  let unit = 1n;
  while (value / unit > 9007199254740991n) unit *= 2n;
  let kept = value / unit; const rest = value % unit;
  if (rest * 2n > unit || rest * 2n === unit && kept % 2n === 1n) kept++;
  let result = 0, bit = 1;
  while (kept > 0n) { if (kept % 2n === 1n) result += bit; kept /= 2n; bit *= 2; }
  while (unit > 1n) { result *= 2; unit /= 2n; }
  return result;
}
function radixDigits(text: string, radix: number, complete: boolean): number {
  let i = 0, end = text.length; while (i < end && space(text.charCodeAt(i))) i++;
  if (complete) while (end > i && space(text.charCodeAt(end - 1))) end--;
  const negative = text[i] === "-"; if (negative || text[i] === "+") i++;
  if (text[i] === "0" && (text[i + 1] === "x" || text[i + 1] === "X") && radix === 16) i += 2;
  else if (complete && text[i] === "0" && (text[i + 1] === "b" || text[i + 1] === "B" || text[i + 1] === "o" || text[i + 1] === "O")) i += 2;
  const digits = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 21n, 22n, 23n, 24n, 25n, 26n, 27n, 28n, 29n, 30n, 31n, 32n];
  let value = 0n; const start = i;
  for (; i < end; i++) { const code = text.charCodeAt(i), digit = code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 90 ? code - 55 : code >= 97 && code <= 122 ? code - 87 : -1; if (digit < 0 || digit >= radix) break; value = value * digits[radix] + digits[digit]; }
  if (i === start || complete && i !== end) return NaN;
  return negative ? -rounded(value) : rounded(value);
}
class BinaryText { text: string; radix: number = 2; constructor(text: string) { this.text = text; } }
function read(input: BinaryText): number { return radixDigits(input.text, input.radix, false); }
const rows: [string, number, number][] = [["1", 1023, 2 ** 1023], ["1".repeat(53), 971, Number.MAX_VALUE], ["1".repeat(54), 970, Infinity], ["1", 1024, Infinity]];
for (const [head, zeros, value] of rows) for (const sign of ["", "+", "-"]) {
  const text = sign + head + "0".repeat(zeros) + "!", input = new BinaryText(text);
  assert.sameValue(read(input), sign === "-" ? -value : value);
  assert.sameValue(input.text, text); assert.sameValue(input.radix, 2);
}
