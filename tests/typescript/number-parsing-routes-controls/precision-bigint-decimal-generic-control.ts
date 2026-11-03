/*---
description: Explicit digit-loop control for bigInt preserves every decimal digit across a constrained generic text route.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-generics, ts-generic-constraints, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-bigint, ts-conversions]
---*/
// Control: BigInt: a constrained generic carries signed and padded decimal strings through 257 bits; node returns each exact bigint and maps either zero sign to 0n.
function space(code: number): boolean { return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233; }
function integer(text: string): bigint {
  let i = 0, end = text.length; while (i < end && space(text.charCodeAt(i))) i++;
  while (end > i && space(text.charCodeAt(end - 1))) end--;
  if (i === end) return 0n;
  const signed = text[i] === "-" || text[i] === "+", negative = text[i] === "-"; if (signed) i++;
  let radix = 10n, limit = 10;
  if (text[i] === "0" && i + 1 < end) {
    const code = text.charCodeAt(i + 1) | 32;
    if (code === 120 || code === 111 || code === 98) { if (signed) throw new SyntaxError("signed prefix"); limit = code === 120 ? 16 : code === 111 ? 8 : 2; radix = code === 120 ? 16n : code === 111 ? 8n : 2n; i += 2; }
  }
  if (i === end) throw new SyntaxError("missing digits");
  const digits = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n]; let value = 0n;
  for (; i < end; i++) { const code = text.charCodeAt(i), digit = code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1; if (digit < 0 || digit >= limit) throw new SyntaxError("invalid digit"); value = value * radix + digits[digit]; }
  return negative ? -value : value;
}
function read<T extends { text: string }>(input: T): bigint { return integer(input.text); }
const rows: [string, bigint][] = [
  ["0", 0n],
  ["9007199254740993", 9007199254740993n],
  ["18446744073709551617", 18446744073709551617n],
  ["340282366920938463463374607431768211457", 340282366920938463463374607431768211457n],
  ["115792089237316195423570985008687907853269984665640564039457584007913129639937", 115792089237316195423570985008687907853269984665640564039457584007913129639937n]
];
for (const [digits, value] of rows) for (const sign of ["", "+", "-"]) for (const padding of ["", "000000000000000000000000"]) {
  const text = "\t" + sign + padding + digits + "\u3000", input = { text, width: digits.length };
  assert.sameValue(read(input), sign === "-" ? -value : value); assert.sameValue(input.text, text);
}
