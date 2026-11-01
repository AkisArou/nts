/*---
description: "A class-held UnicodeSets subtraction matcher keeps shared state and optional ASCII suffix captures visible to its caller."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-class, ts-class-fields, ts-narrowing]
---*/
// A class reader retains a v matcher for Letter minus ASCII; node returns original non-ASCII runs, optionally consumes a following a and exposes exact UTF-16 positions through the stored RegExp.
type UnicodeStep = [number, number, number, (string | undefined)[] | null];
type UnicodeSample = [string, UnicodeStep[]];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function observe(match: RegExpExecArray | null, before: number, after: number, text: string, wanted: UnicodeStep, log: unknown[], expected: unknown[]): void {
  same(before, wanted[0]); same(after, wanted[2]); log.push("exec", before, after); expected.push("exec", wanted[0], wanted[2]);
  const captures = wanted[3]; if (match === null) { same(captures, null); log.push(null); expected.push(null); return; } if (captures === null) throw new Error("unexpected match");
  same(match.index, wanted[1]); same(match.input, text); same(match.length, captures.length); log.push(match.index, match.input, match.length); expected.push(wanted[1], text, captures.length);
  for (let at = 0; at < captures.length; at++) { const value: string | undefined = match[at]; same(value, captures[at]); log.push(value); expected.push(captures[at]); }
  same(match.groups, undefined); log.push(match.groups); expected.push(undefined);
}
const samples: UnicodeSample[] = [
  ["", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["ASCII", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["\u00e9a\u03a9b", [[0, 0, 2, ["\u00e9a", "\u00e9", "a", ""]], [2, 2, 3, ["\u03a9", "\u03a9", undefined, ""]], [3, -1, 0, null], [0, 0, 2, ["\u00e9a", "\u00e9", "a", ""]]]],
  ["\ud83d\ude00\ud801\udc00a\u017f", [[0, 2, 5, ["\ud801\udc00a", "\ud801\udc00", "a", ""]], [5, 5, 6, ["\u017f", "\u017f", undefined, ""]], [6, -1, 0, null], [0, 2, 5, ["\ud801\udc00a", "\ud801\udc00", "a", ""]]]],
  ["\u212a\u0131a", [[0, 0, 3, ["\u212a\u0131a", "\u212a\u0131", "a", ""]], [3, -1, 0, null], [0, 0, 3, ["\u212a\u0131a", "\u212a\u0131", "a", ""]]]],
  ["\ud83d\u00e9\ude00\u03b2a", [[0, 1, 2, ["\u00e9", "\u00e9", undefined, ""]], [2, 3, 5, ["\u03b2a", "\u03b2", "a", ""]], [5, -1, 0, null], [0, 1, 2, ["\u00e9", "\u00e9", undefined, ""]]]],
  ["\u00e9\u0301\u03a9", [[0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]], [1, 2, 3, ["\u03a9", "\u03a9", undefined, ""]], [3, -1, 0, null], [0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]]]],
  ["\u00e9\n\u03a9a", [[0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]], [1, 2, 4, ["\u03a9a", "\u03a9", "a", ""]], [4, -1, 0, null], [0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]]]],
  ["\u00e9\r\n\u03a9", [[0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]], [1, 3, 4, ["\u03a9", "\u03a9", undefined, ""]], [4, -1, 0, null], [0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]]]],
  ["\u00e9\u2028\u03a9", [[0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]], [1, 2, 3, ["\u03a9", "\u03a9", undefined, ""]], [3, -1, 0, null], [0, 0, 1, ["\u00e9", "\u00e9", undefined, ""]]]],
  ["123\ud83d\ude00\u0301", [[0, -1, 0, null], [0, -1, 0, null]]],
];
class UnicodeReader {
  pattern: RegExp; constructor(pattern: RegExp) { this.pattern = pattern; }
  next(text: string): RegExpExecArray | null { return this.pattern.exec(text); }
}
function inspect(expression: RegExp, sample: UnicodeSample): void {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; expression.lastIndex = sample[1][0][0]; same(expression.flags, "gv");
  const reader = new UnicodeReader(expression); same(reader.pattern, expression);
  for (const wanted of sample[1]) {
    const before = reader.pattern.lastIndex, match = reader.next(text); same(expression.lastIndex, wanted[2]); observe(match, before, reader.pattern.lastIndex, text, wanted, log, expected);
  }
  assert.compareArray(log, expected);
}
for (const sample of samples) {
  const literal = /([\p{L}--\p{ASCII}]+)(a)?()/gv; for (const expression of [literal, new RegExp(literal.source, literal.flags)]) { inspect(expression, sample); same(expression.lastIndex, sample[1][sample[1].length - 1][2]); }
}
