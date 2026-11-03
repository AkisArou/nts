/*---
description: parseFloat rounds long integer prefixes delivered by a declared string return.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// parseFloat: a declared string return carries wide integer prefixes; node rounds the full digit run before stopping at the unit suffix.
function carry(text: string): string { return text; }
function read(text: string): number { return parseFloat(carry(text)); }
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
