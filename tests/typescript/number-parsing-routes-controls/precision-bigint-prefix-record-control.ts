/*---
description: Explicit digit-loop control for bigInt preserves wide prefixed digits through a typed string record.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-record, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-bigint, ts-conversions]
---*/
// Control: BigInt: a Record field carries both-case hexadecimal, octal and binary prefixes with wide digits; node retains wide values and every hexadecimal letter case exactly, including hexadecimal 1e3 as 483n.
function space(code: number): boolean { return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233; }
function integer(text: string): bigint {
  let i = 0, end = text.length; while (i < end && space(text.charCodeAt(i))) i++;
  while (end > i && space(text.charCodeAt(end - 1))) end--;
  if (i === end) return 0n;
  const signed = text[i] === "-" || text[i] === "+", negative = text[i] === "-"; if (signed) i++;
  let radix = 10n, limit = 10;
  if (text[i] === "0" && i + 1 < end) {
    const code = text.charCodeAt(i + 1) | 32;
    if (code === 120 || code === 111 || code === 98) { if (signed) throw new SyntaxError("signed prefix"); limit = code === 120 ? 16 : code === 111 ? 8 : 2; radix = code === 120 ? 16n : code === 111 ? 8n : 2n; i += 2; }
  }
  if (i === end) throw new SyntaxError("missing digits");
  const digits = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n]; let value = 0n;
  for (; i < end; i++) { const code = text.charCodeAt(i), digit = code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1; if (digit < 0 || digit >= limit) throw new SyntaxError("invalid digit"); value = value * radix + digits[digit]; }
  return negative ? -value : value;
}
function read(input: Record<string, string>): bigint { return integer(input.text); }
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
