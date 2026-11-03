/*---
description: BigInt preserves wide prefixed digits through a typed string record.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-record, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-bigint, ts-conversions]
---*/
// BigInt: a Record field carries both-case hexadecimal, octal and binary prefixes with wide digits; node retains wide values and every hexadecimal letter case exactly, including hexadecimal 1e3 as 483n.
function read(input: Record<string, string>): bigint { return BigInt(input.text); }
const rows: [string, string][] = [
  ["0x", "100000000000000000000000000000001"],
  ["0X", "100000000000000000000000000000001"],
  ["0o", "4000000000000000000000000000000000000000001"],
  ["0O", "4000000000000000000000000000000000000000001"],
  ["0b", "100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"],
  ["0B", "100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"]
];
for (const [prefix, digits] of rows) for (const padding of ["", "00000000000000000000"]) {
  const text = "\ufeff" + prefix + padding + digits + "\n", input: Record<string, string> = { text };
  assert.sameValue(read(input), 340282366920938463463374607431768211457n); assert.sameValue(input.text, text);
}
const hexRows: [string, bigint][] = [
  ["abcdefabcdefabcdefabcdefabcdefab", 228367269242865488226617675850972000171n],
  ["ABCDEFABCDEFABCDEFABCDEFABCDEFAB", 228367269242865488226617675850972000171n],
  ["aBcDeFAbCdEfaBcDeFAbCdEfaBcDeFAb", 228367269242865488226617675850972000171n], ["1e3", 483n], ["1E3", 483n]
];
for (const [digits, value] of hexRows) for (const prefix of ["0x", "0X"]) for (const padding of ["", "00000000000000000000"]) {
  const text = "\ufeff" + prefix + padding + digits + "\n", input: Record<string, string> = { text };
  assert.sameValue(read(input), value); assert.sameValue(input.text, text);
}
