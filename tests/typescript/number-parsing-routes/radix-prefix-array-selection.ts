/*---
description: Explicit radices decide whether x is a prefix marker, an invalid digit or an ordinary digit after a string-array read.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-null-undefined, ts-optional-parameters, ts-readonly]
---*/
// parseInt reads a string-array element; node strips x/X only for inferred or hexadecimal radix, while bases 16, 32 and 36 interpret b/o/x as ordinary eligible digits otherwise.
function consume(input: readonly string[], radix?: number): number { return parseInt(input[1], radix); }
const radices: (number | undefined)[] = [undefined, 0, 16, 10, 32, 36];
const rows: [string, number[]][] = [
  ["0x21", [33, 33, 33, 0, 0, 42841]], ["0X21", [33, 33, 33, 0, 0, 42841]],
  ["0x", [NaN, NaN, NaN, 0, 0, 33]], ["0X", [NaN, NaN, NaN, 0, 0, 33]],
  ["0xg", [NaN, NaN, NaN, 0, 0, 1204]], ["0XG", [NaN, NaN, NaN, 0, 0, 1204]],
  ["0b11", [0, 0, 2833, 0, 11297, 14293]], ["0B11", [0, 0, 2833, 0, 11297, 14293]],
  ["0o11", [0, 0, 0, 0, 24609, 31141]], ["0O11", [0, 0, 0, 0, 24609, 31141]]
];
for (const [body, expected] of rows) for (const sign of ["", "+", "-"]) for (let index = 0; index < radices.length; index++) {
  const text = sign + body, input: string[] = ["sentinel", text], factor = sign === "-" ? -1 : 1;
  assert.sameValue(consume(input, radices[index]), factor * expected[index], text); assert.compareArray(input, ["sentinel", text]);
}
