/*---
description: parseInt accepts every ECMAScript whitespace boundary and checks empty inputs through a interface field.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-interfaces, ts-objects]
---*/
// parseInt: interface-field carries the original text; node trims all 25 code points and returns NaN for empty or whitespace-only text.
interface TextSlot { text: string; }
function read(slot: TextSlot): number { return parseInt(slot.text); }
const spaces: string[] = [
  "\t", "\u000b", "\f", " ", "\u00a0", "\ufeff", "\u1680", "\u2000", "\u2001", "\u2002",
  "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u202f",
  "\u205f", "\u3000", "\n", "\r", "\u2028", "\u2029"
];
const rows: [string, number][] = [["17", 17], ["-28", -28], ["+35", 35]];
for (const space of spaces) for (const [digits, expected] of rows) {
  for (const text of [space + digits, digits + space, space + digits + space]) {
    assert.sameValue(read({ text }), expected);
  }
}
const blanks: string[] = ["", spaces.join("")];
for (const space of spaces) blanks.push(space, space + space);
for (const text of blanks) assert.sameValue(read({ text }), NaN);
