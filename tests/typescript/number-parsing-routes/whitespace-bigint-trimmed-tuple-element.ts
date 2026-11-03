/*---
description: BigInt accepts every ECMAScript whitespace boundary and checks empty inputs through a tuple element.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-type-aliases, ts-bigint]
---*/
// BigInt: tuple-element carries the original text; node trims all 25 code points and returns 0n for empty or whitespace-only text.
type TextTuple = [label: string, text: string];
function read(pair: TextTuple): bigint { return BigInt(pair[1]); }
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
