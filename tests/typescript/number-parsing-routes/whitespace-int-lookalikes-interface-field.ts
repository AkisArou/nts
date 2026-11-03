/*---
description: parseInt distinguishes excluded whitespace on both sides through a interface field.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-interfaces, ts-objects]
---*/
// parseInt: interface-field carries the original text; node stops only the partial parsers at a trailing look-alike and rejects an excluded leading code point.
interface TextSlot { text: string; }
function read(slot: TextSlot): number { return parseInt(slot.text); }
const excluded: string[] = ["\u180e", "\u200b", "\u0085"];
const rows: [string, number][] = [["17", 17], ["-28", -28], ["+35", 35]];
for (const mark of excluded) for (const [digits, expected] of rows) {
  for (const text of [mark + digits, " " + mark + digits + "\t", mark]) assert.sameValue(read({ text }), NaN);
  for (const text of [digits + mark, "\n" + digits + mark + " "]) assert.sameValue(read({ text }), expected);
  const text = "1" + mark + "2"; assert.sameValue(read({ text }), 1);
}
