/*---
description: Every radix accepts its highest digit in either case and stops at its first excluded digit through a Record field.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-record, ts-tuples]
---*/
// parseInt reads a Record text field and declared radix; node accumulates two valid digits exactly, stops at the alphabet boundary and returns NaN when that boundary is first.
function consume(input: Record<"text", string>, radix: number): number { return parseInt(input.text, radix); }
const radices: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
const alphabets: string[] = ["0123456789abcdefghijklmnopqrstuvwxyz", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
for (const radix of radices) for (const alphabet of alphabets) for (const sign of ["", "+", "-"]) {
  const highest = alphabet.charAt(radix - 1), excluded = radix === 36 ? "!" : alphabet.charAt(radix), factor = sign === "-" ? -1 : 1;
  const rows: [string, number][] = [[highest + "1" + excluded + "9", (radix - 1) * radix + 1], ["1" + highest + excluded + "9", 2 * radix - 1], [excluded + highest, NaN]];
  for (const [body, expected] of rows) {
    const text = sign + body, input: Record<"text", string> = { text };
    assert.sameValue(consume(input, radix), factor * expected, text); assert.sameValue(input.text, text);
  }
}
