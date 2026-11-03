/*---
description: Power-radix parseInt rounds long strings read from a typed record.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-record, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// parseInt: a Record field carries 64-bit and 128-bit digit strings; node rounds their exact integer prefixes in bases 2, 4, 8, 16 and 32.
function read(texts: Record<string, string>, radix: number): number { return parseInt(texts.digits, radix); }
const rows: [string, number, number][] = [
  ["1111111111111111111111111111111111111111111111111111111111111111", 2, 2 ** 64],
  ["10000000000000000000000000000000000000000000000000000100000000001", 2, 2 ** 64 + 4096],
  ["11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111", 2, 2 ** 128],
  ["33333333333333333333333333333333", 4, 2 ** 64],
  ["100000000000000000000000000200001", 4, 2 ** 64 + 4096],
  ["3333333333333333333333333333333333333333333333333333333333333333", 4, 2 ** 128],
  ["1777777777777777777777", 8, 2 ** 64],
  ["2000000000000000004001", 8, 2 ** 64 + 4096],
  ["3777777777777777777777777777777777777777777", 8, 2 ** 128],
  ["ffffffffffffffff", 16, 2 ** 64],
  ["10000000000000801", 16, 2 ** 64 + 4096],
  ["ffffffffffffffffffffffffffffffff", 16, 2 ** 128],
  ["fvvvvvvvvvvvv", 32, 2 ** 64],
  ["g000000000201", 32, 2 ** 64 + 4096],
  ["7vvvvvvvvvvvvvvvvvvvvvvvvv", 32, 2 ** 128]
];
for (const [digits, radix, value] of rows) for (const sign of ["", "+", "-"]) {
  const text = " " + sign + (radix === 16 ? "0X" : "") + digits + "!", texts: Record<string, string> = { digits: text };
  assert.sameValue(read(texts, radix), sign === "-" ? -value : value);
  assert.sameValue(texts.digits, text);
}
