/*---
description: Code-unit scan control for parseInt distinguishes excluded whitespace on both sides through a interface field.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-interfaces, ts-objects]
---*/
// Explicit scan for parseInt: interface-field carries the original text; node stops only the partial parsers at a trailing look-alike and rejects an excluded leading code point.
function isSpace(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 ||
    (code >= 8192 && code <= 8202) || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233;
}
function scan(text: string): number {
  let start = 0, end = text.length;
  while (start < end && isSpace(text.charCodeAt(start))) start++;
  if (start === end) return NaN;
  const negative = text.charCodeAt(start) === 45;
  if (negative || text.charCodeAt(start) === 43) start++;
  let value = 0, count = 0, scale = 1, fraction = false;
  for (; start < end; start++) {
    const code = text.charCodeAt(start);
    if (code < 48 || code > 57) break;
    value = value * 10 + code - 48; count++; if (fraction) scale *= 10;
  }
  if (count === 0) return NaN;
  return negative ? -(value / scale) : value / scale;
}
interface TextSlot { text: string; }
function read(slot: TextSlot): number { return scan(slot.text); }
const excluded: string[] = ["\u180e", "\u200b", "\u0085"];
const rows: [string, number][] = [["17", 17], ["-28", -28], ["+35", 35]];
for (const mark of excluded) for (const [digits, expected] of rows) {
  for (const text of [mark + digits, " " + mark + digits + "\t", mark]) assert.sameValue(read({ text }), NaN);
  for (const text of [digits + mark, "\n" + digits + mark + " "]) assert.sameValue(read({ text }), expected);
  const text = "1" + mark + "2"; assert.sameValue(read({ text }), 1);
}
