/*---
description: Number distinguishes excluded whitespace on both sides through a generic return.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-generics]
---*/
// Number: generic-return carries the original text; node stops only the partial parsers at a trailing look-alike and rejects an excluded leading code point.
function carry<T>(value: T): T { return value; }
function read(text: string): number { return Number(carry<string>(text)); }
const excluded: string[] = ["\u180e", "\u200b", "\u0085"];
const rows: [string, number][] = [["17.25", 17.25], ["-28.125", -28.125], ["+35.5", 35.5]];
for (const mark of excluded) for (const [digits, expected] of rows) {
  for (const text of [mark + digits, " " + mark + digits + "\t", mark]) assert.sameValue(read(text), NaN);
  for (const text of [digits + mark, "\n" + digits + mark + " "]) assert.sameValue(read(text), NaN);
  const text = "1" + mark + "2"; assert.sameValue(read(text), NaN);
}
