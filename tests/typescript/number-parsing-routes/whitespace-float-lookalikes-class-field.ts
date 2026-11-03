/*---
description: parseFloat distinguishes excluded whitespace on both sides through a class field.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-class, ts-class-fields]
---*/
// parseFloat: class-field carries the original text; node stops only the partial parsers at a trailing look-alike and rejects an excluded leading code point.
class TextCell { text: string; constructor(text: string) { this.text = text; } }
function read(cell: TextCell): number { return parseFloat(cell.text); }
const excluded: string[] = ["\u180e", "\u200b", "\u0085"];
const rows: [string, number][] = [["17.25", 17.25], ["-28.125", -28.125], ["+35.5", 35.5]];
for (const mark of excluded) for (const [digits, expected] of rows) {
  for (const text of [mark + digits, " " + mark + digits + "\t", mark]) assert.sameValue(read(new TextCell(text)), NaN);
  for (const text of [digits + mark, "\n" + digits + mark + " "]) assert.sameValue(read(new TextCell(text)), expected);
  const text = "1" + mark + "2"; assert.sameValue(read(new TextCell(text)), 1);
}
