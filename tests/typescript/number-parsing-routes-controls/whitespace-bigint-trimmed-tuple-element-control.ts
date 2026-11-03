/*---
description: Code-unit scan control for BigInt accepts every ECMAScript whitespace boundary and checks empty inputs through a tuple element.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-type-aliases, ts-bigint]
---*/
// Explicit scan for BigInt: tuple-element carries the original text; node trims all 25 code points and returns 0n for empty or whitespace-only text.
function isSpace(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 ||
    (code >= 8192 && code <= 8202) || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233;
}
function scan(text: string): bigint {
  let start = 0, end = text.length;
  while (start < end && isSpace(text.charCodeAt(start))) start++;
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--;
  if (start === end) return 0n;
  const negative = text.charCodeAt(start) === 45;
  if (negative || text.charCodeAt(start) === 43) start++;
  if (start === end) throw new SyntaxError("digits");
  const digits: bigint[] = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]; let value = 0n;
  for (; start < end; start++) {
    const digit = text.charCodeAt(start) - 48;
    if (digit < 0 || digit > 9) throw new SyntaxError("digit");
    value = value * 10n + digits[digit];
  }
  return negative ? -value : value;
}
type TextTuple = [label: string, text: string];
function read(pair: TextTuple): bigint { return scan(pair[1]); }
const spaces: string[] = [
  "\t", "\u000b", "\f", " ", "\u00a0", "\ufeff", "\u1680", "\u2000", "\u2001", "\u2002",
  "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u202f",
  "\u205f", "\u3000", "\n", "\r", "\u2028", "\u2029"
];
const rows: [string, bigint][] = [["17", 17n], ["-28", -28n], ["+35", 35n]];
for (const space of spaces) for (const [digits, expected] of rows) {
  for (const text of [space + digits, digits + space, space + digits + space]) {
    assert.sameValue(read(["input", text]), expected);
  }
}
const blanks: string[] = ["", spaces.join("")];
for (const space of spaces) blanks.push(space, space + space);
for (const text of blanks) assert.sameValue(read(["input", text]), 0n);
