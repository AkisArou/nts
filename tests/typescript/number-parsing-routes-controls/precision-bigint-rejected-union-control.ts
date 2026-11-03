/*---
description: Explicit digit-loop control for bigInt rejects every noninteger string class after a declared union is narrowed.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-unions, ts-narrowing, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-bigint, ts-conversions, ts-errors]
---*/
// Control: BigInt: the text arm of a union carries invalid decimal and prefixed strings; node throws SyntaxError for each, while complete integer spellings produce 17n.
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
type IntegerChoice = { kind: "text"; text: string } | { kind: "value"; value: bigint };
function read(input: IntegerChoice): bigint { if (input.kind === "text") return integer(input.text); return input.value; }
const invalid: string[] = [
  "1.5", "1n", "1e3", "-1.5", "+1e3", "0.0", ".0", "5.", "0e0", "NaN", "Infinity", "+Infinity", "-Infinity",
  "+", "-", "++1", "--1", "+-1", "-+1", "1_000", "1 2", "1\u00002", "１２", "0x", "0X", "0b", "0B", "0o", "0O",
  "0xg", "0o8", "0b2", "0x1.0", "0b1e2", "0o7n", "0x1n", "0b1n", "0x1_0", "0o7_0", "0b1_0", "17units"
];
for (const prefix of ["0x", "0X", "0o", "0O", "0b", "0B"]) for (const sign of ["+", "-"]) for (const digits of ["0", "1", "10"]) invalid.push(sign + prefix + digits);
for (const text of invalid) {
  const input: IntegerChoice = { kind: "text", text };
  assert.throws(SyntaxError, () => read(input)); assert.sameValue(input.text, text);
}
for (const text of ["17", "+17", "0x11", "0X11", "0o21", "0O21", "0b10001", "0B10001"]) {
  const input: IntegerChoice = { kind: "text", text };
  assert.sameValue(read(input), 17n); assert.sameValue(input.text, text);
}
assert.sameValue(read({ kind: "value", value: -17n }), -17n);
