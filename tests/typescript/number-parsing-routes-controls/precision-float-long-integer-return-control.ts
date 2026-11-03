/*---
description: Explicit digit-loop control for parseFloat rounds long integer prefixes delivered by a declared string return.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-bigint]
---*/
// Control: parseFloat: a declared string return carries wide integer prefixes; node rounds the full digit run before stopping at the unit suffix.
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
function decimal(text: string, complete: boolean): number {
  let i = 0, end = text.length; while (i < end && space(text.charCodeAt(i))) i++;
  if (complete) while (end > i && space(text.charCodeAt(end - 1))) end--;
  const negative = text[i] === "-"; if (negative || text[i] === "+") i++;
  const start = i, digits = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]; let value = 0n;
  for (; i < end; i++) { const digit = text.charCodeAt(i) - 48; if (digit < 0 || digit > 9) break; value = value * 10n + digits[digit]; }
  if (i === start || complete && i !== end) return NaN;
  return negative ? -rounded(value) : rounded(value);
}
function carry(text: string): string { return text; }
function read(text: string): number { return decimal(carry(text), false); }
const rows: [string, number][] = [
  ["9007199254740995", 9007199254740996], ["9007199254740997", 9007199254740996],
  ["340282366920938463463374607431768211455", 2 ** 128],
  ["340282366920938463463374607431768211457", 2 ** 128],
  ["340282366920938539021238333346091630593", 2 ** 128 + 2 ** 76],
  ["115792089237316195423570985008687907853269984665640564039457584007913129639935", 2 ** 256]
];
for (const [digits, value] of rows) for (const sign of ["", "+", "-"]) for (const tail of ["px", "_000", "n"]) {
  const text = sign + digits + tail;
  assert.sameValue(read(text), sign === "-" ? -value : value); assert.sameValue(carry(text), text);
}
