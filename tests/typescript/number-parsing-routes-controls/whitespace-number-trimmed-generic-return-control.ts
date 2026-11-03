/*---
description: Code-unit scan control for Number accepts every ECMAScript whitespace boundary and checks empty inputs through a generic return.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-generics]
---*/
// Explicit scan for Number: generic-return carries the original text; node trims all 25 code points and returns 0 for empty or whitespace-only text.
function isSpace(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 ||
    (code >= 8192 && code <= 8202) || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233;
}
function scan(text: string): number {
  let start = 0, end = text.length;
  while (start < end && isSpace(text.charCodeAt(start))) start++;
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--;
  if (start === end) return 0;
  const negative = text.charCodeAt(start) === 45;
  if (negative || text.charCodeAt(start) === 43) start++;
  let value = 0, count = 0, scale = 1, fraction = false;
  for (; start < end; start++) {
    const code = text.charCodeAt(start);
    if (code === 46 && !fraction) { fraction = true; continue; }
    if (code < 48 || code > 57) break;
    value = value * 10 + code - 48; count++; if (fraction) scale *= 10;
  }
  if (start !== end) return NaN;
  if (count === 0) return NaN;
  return negative ? -(value / scale) : value / scale;
}
function carry<T>(value: T): T { return value; }
function read(text: string): number { return scan(carry<string>(text)); }
const spaces: string[] = [
  "\t", "\u000b", "\f", " ", "\u00a0", "\ufeff", "\u1680", "\u2000", "\u2001", "\u2002",
  "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u202f",
  "\u205f", "\u3000", "\n", "\r", "\u2028", "\u2029"
];
const rows: [string, number][] = [["17.25", 17.25], ["-28.125", -28.125], ["+35.5", 35.5]];
for (const space of spaces) for (const [digits, expected] of rows) {
  for (const text of [space + digits, digits + space, space + digits + space]) {
    assert.sameValue(read(text), expected);
  }
}
const blanks: string[] = ["", spaces.join("")];
for (const space of spaces) blanks.push(space, space + space);
for (const text of blanks) assert.sameValue(read(text), 0);
