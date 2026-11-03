/*---
description: parseInt reaches the finite and infinite binary64 boundary through declared class fields.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// parseInt: class fields carry binary digits and their radix; node returns 2^1023 and the largest finite number, then rounds the halfway overflow and 2^1024 to infinity.
class BinaryText { text: string; radix: number = 2; constructor(text: string) { this.text = text; } }
function read(input: BinaryText): number { return parseInt(input.text, input.radix); }
const rows: [string, number, number][] = [["1", 1023, 2 ** 1023], ["1".repeat(53), 971, Number.MAX_VALUE], ["1".repeat(54), 970, Infinity], ["1", 1024, Infinity]];
for (const [head, zeros, value] of rows) for (const sign of ["", "+", "-"]) {
  const text = sign + head + "0".repeat(zeros) + "!", input = new BinaryText(text);
  assert.sameValue(read(input), sign === "-" ? -value : value);
  assert.sameValue(input.text, text); assert.sameValue(input.radix, 2);
}
