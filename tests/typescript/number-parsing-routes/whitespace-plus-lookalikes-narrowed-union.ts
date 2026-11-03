/*---
description: unary plus distinguishes excluded whitespace on both sides through a narrowed union.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-unions, ts-narrowing, ts-type-aliases]
---*/
// unary plus: narrowed-union carries the original text; node stops only the partial parsers at a trailing look-alike and rejects an excluded leading code point.
type TextChoice = { kind: "text"; text: string } | { kind: "absent" };
function read(choice: TextChoice): number { return choice.kind === "text" ? +(choice.text) : NaN; }
const excluded: string[] = ["\u180e", "\u200b", "\u0085"];
const rows: [string, number][] = [["17.25", 17.25], ["-28.125", -28.125], ["+35.5", 35.5]];
for (const mark of excluded) for (const [digits, expected] of rows) {
  for (const text of [mark + digits, " " + mark + digits + "\t", mark]) assert.sameValue(read({ kind: "text", text }), NaN);
  for (const text of [digits + mark, "\n" + digits + mark + " "]) assert.sameValue(read({ kind: "text", text }), NaN);
  const text = "1" + mark + "2"; assert.sameValue(read({ kind: "text", text }), NaN);
}
