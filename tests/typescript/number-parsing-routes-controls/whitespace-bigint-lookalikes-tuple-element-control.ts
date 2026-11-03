/*---
description: Code-unit scan control for BigInt distinguishes excluded whitespace on both sides through a tuple element.
features: [ts-number-parsing-routes, ts-number-parsing-route-whitespace, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-type-aliases, ts-bigint, ts-errors]
---*/
// Explicit scan for BigInt: tuple-element carries the original text; node throws SyntaxError for each excluded code point, even beside real whitespace.
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
const excluded: string[] = ["\u180e", "\u200b", "\u0085"];
for (const mark of excluded) for (const digits of ["17", "-28", "+35"]) {
  for (const text of [mark + digits, digits + mark, " " + mark + digits + "\t", "\n" + digits + mark + " ", mark, "1" + mark + "2"]) {
    assert.throws(SyntaxError, () => read(["input", text]));
  }
}
