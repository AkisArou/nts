/*---
description: "Array.from copies string code points rather than splitting astral characters into UTF-16 units. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localFrom<T>(source: Iterable<T>): T[] {
  const result: T[] = [];
  for (const value of source) result[result.length] = value;
  return result;
}
// Array.from copies string code points rather than splitting astral characters into UTF-16 units. Route: a private string field. Node prints construction-from-string-private-codepoints:ok.
class TextReader {
  #text: string; constructor(text: string) { this.#text = text; }
  copy(): string[] { return localFrom(this.#text); }
}
const rows: readonly [string, readonly string[], number][] = [
  ["", [], 0], ["a", ["a"], 1], ["\u{1f600}", ["\u{1f600}"], 2],
  ["a\u{1f600}b", ["a", "\u{1f600}", "b"], 4],
  ["\u{1d11e}x\u{1f600}", ["\u{1d11e}", "x", "\u{1f600}"], 5], ["e\u0301", ["e", "\u0301"], 2]
];
for (const [text, expected, units] of rows) {
  const result = new TextReader(text).copy();
  assert.compareArray(result, expected); assert.sameValue(result.length, expected.length);
  assert.sameValue(text.length, units);
}
console.log("construction-from-string-private-codepoints:ok");
