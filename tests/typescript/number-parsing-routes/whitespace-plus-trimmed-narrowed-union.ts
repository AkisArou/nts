/*---
description: unary plus accepts every ECMAScript whitespace boundary and checks empty inputs through a narrowed union.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-unions, ts-narrowing, ts-type-aliases]
---*/
// unary plus: narrowed-union carries the original text; node trims all 25 code points and returns 0 for empty or whitespace-only text.
type TextChoice = { kind: "text"; text: string } | { kind: "absent" };
function read(choice: TextChoice): number { return choice.kind === "text" ? +(choice.text) : NaN; }
const spaces: string[] = [
  "\t", "\u000b", "\f", " ", "\u00a0", "\ufeff", "\u1680", "\u2000", "\u2001", "\u2002",
  "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u202f",
  "\u205f", "\u3000", "\n", "\r", "\u2028", "\u2029"
];
const rows: [string, number][] = [["17.25", 17.25], ["-28.125", -28.125], ["+35.5", 35.5]];
for (const space of spaces) for (const [digits, expected] of rows) {
  for (const text of [space + digits, digits + space, space + digits + space]) {
    assert.sameValue(read({ kind: "text", text }), expected);
  }
}
const blanks: string[] = ["", spaces.join("")];
for (const space of spaces) blanks.push(space, space + space);
for (const text of blanks) assert.sameValue(read({ kind: "text", text }), 0);
