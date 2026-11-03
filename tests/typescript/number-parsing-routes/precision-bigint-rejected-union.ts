/*---
description: BigInt rejects every noninteger string class after a declared union is narrowed.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-unions, ts-narrowing, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-bigint, ts-conversions, ts-errors]
---*/
// BigInt: the text arm of a union carries invalid decimal and prefixed strings; node throws SyntaxError for each, while complete integer spellings produce 17n.
type IntegerChoice = { kind: "text"; text: string } | { kind: "value"; value: bigint };
function read(input: IntegerChoice): bigint { if (input.kind === "text") return BigInt(input.text); return input.value; }
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
