/*---
description: BigInt preserves every decimal digit across a constrained generic text route.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-generics, ts-generic-constraints, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-bigint, ts-conversions]
---*/
// BigInt: a constrained generic carries signed and padded decimal strings through 257 bits; node returns each exact bigint and maps either zero sign to 0n.
function read<T extends { text: string }>(input: T): bigint { return BigInt(input.text); }
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
