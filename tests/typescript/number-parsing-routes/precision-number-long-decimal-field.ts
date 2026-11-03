/*---
description: Number rounds long decimal integers from an interface field.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-interfaces, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// Number: an interface field carries long decimal integers with padding and signs; node rounds 128-bit and 256-bit values to the specified neighboring binary64 integers.
interface DecimalText { text: string; }
function read(input: DecimalText): number { return Number(input.text); }
const rows: [string, number][] = [
  ["340282366920938463463374607431768211455", 2 ** 128],
  ["340282366920938463463374607431768211457", 2 ** 128],
  ["340282366920938539021238333346091630593", 2 ** 128 + 2 ** 76],
  ["115792089237316195423570985008687907853269984665640564039457584007913129639935", 2 ** 256]
];
for (const [digits, value] of rows) for (const sign of ["", "+", "-"]) for (const padding of ["", "000000000000000000000000000000"]) {
  const text = "\t" + sign + padding + digits + "\n", input: DecimalText = { text };
  assert.sameValue(read(input), sign === "-" ? -value : value); assert.sameValue(input.text, text);
}
