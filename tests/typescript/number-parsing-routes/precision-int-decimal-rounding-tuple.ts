/*---
description: Decimal parseInt rounds both tie parities after a typed tuple element.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-tuples, ts-readonly, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// parseInt: a tuple element carries signed and padded integer text; node rounds the complete digit prefix to the nearest binary64 value, retaining negative zero.
type Input = readonly [text: string, radix: number];
function read(input: Input): number { return parseInt(input[0], input[1]); }
const rows: [string, number][] = [
  ["0", 0], ["9007199254740995", 9007199254740996], ["9007199254740997", 9007199254740996],
  ["18014398509481985", 18014398509481984], ["18014398509481987", 18014398509481988],
  ["18446744073709551615", 18446744073709551616], ["18446744073709553665", 18446744073709555712]
];
for (const [digits, value] of rows) for (const sign of ["", "+", "-"]) for (const padding of ["", "000000000000000000000000000000"]) for (const tail of ["", "units"]) {
  const text = " " + sign + padding + digits + tail, input: Input = [text, 10];
  assert.sameValue(read(input), sign === "-" ? -value : value);
  assert.sameValue(input[0], text); assert.sameValue(input[1], 10);
}
