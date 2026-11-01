/*---
description: "A generic RegExp helper returns exact Unicode Letter captures and combining-mark tails while preserving the shared cursor."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-generics, ts-generic-constraints, ts-narrowing]
---*/
// A matcher crosses T extends RegExp and returns RegExpExecArray or null; node preserves Letter runs, empty mark tails, astral widths and the caller-visible lastIndex.
type UnicodeStep = [number, number, number, (string | undefined)[] | null];
type UnicodeSample = [string, UnicodeStep[]];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function observe(match: RegExpExecArray | null, before: number, after: number, text: string, wanted: UnicodeStep, log: unknown[], expected: unknown[]): void {
  same(before, wanted[0]); same(after, wanted[2]); log.push("exec", before, after); expected.push("exec", wanted[0], wanted[2]);
  const captures = wanted[3]; if (match === null) { same(captures, null); log.push(null); expected.push(null); return; } if (captures === null) throw new Error("unexpected match");
  same(match.index, wanted[1]); same(match.input, text); same(match.length, captures.length); log.push(match.index, match.input, match.length); expected.push(wanted[1], text, captures.length);
  for (let at = 0; at < captures.length; at++) { const value: string | undefined = match[at]; same(value, captures[at]); log.push(value); expected.push(captures[at]); }
  const groups = match.groups; if (groups === undefined) throw new Error("missing named group"); assert.compareArray(Object.keys(groups), ["letters"]); same(groups.letters, captures[1]); log.push("group", "letters", groups.letters); expected.push("group", "letters", captures[1]);
}
const samples: UnicodeSample[] = [
  ["", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["abc Z", [[0, 0, 3, ["abc", "abc", ""]], [3, 4, 5, ["Z", "Z", ""]], [5, -1, 0, null], [0, 0, 3, ["abc", "abc", ""]]]],
  ["\ud83d\ude00A\u0301\u03b2", [[0, 2, 4, ["A\u0301", "A", "\u0301"]], [4, 4, 5, ["\u03b2", "\u03b2", ""]], [5, -1, 0, null], [0, 2, 4, ["A\u0301", "A", "\u0301"]]]],
  ["\ud801\udc00\u0301 \u03a9", [[0, 0, 3, ["\ud801\udc00\u0301", "\ud801\udc00", "\u0301"]], [3, 4, 5, ["\u03a9", "\u03a9", ""]], [5, -1, 0, null], [0, 0, 3, ["\ud801\udc00\u0301", "\ud801\udc00", "\u0301"]]]],
  ["\ud83dA\ude00B", [[0, 1, 2, ["A", "A", ""]], [2, 3, 4, ["B", "B", ""]], [4, -1, 0, null], [0, 1, 2, ["A", "A", ""]]]],
  ["e\u0301x", [[0, 0, 2, ["e\u0301", "e", "\u0301"]], [2, 2, 3, ["x", "x", ""]], [3, -1, 0, null], [0, 0, 2, ["e\u0301", "e", "\u0301"]]]],
  ["A\nB", [[0, 0, 1, ["A", "A", ""]], [1, 2, 3, ["B", "B", ""]], [3, -1, 0, null], [0, 0, 1, ["A", "A", ""]]]],
  ["A\r\nB", [[0, 0, 1, ["A", "A", ""]], [1, 3, 4, ["B", "B", ""]], [4, -1, 0, null], [0, 0, 1, ["A", "A", ""]]]],
  ["A\u2028B", [[0, 0, 1, ["A", "A", ""]], [1, 2, 3, ["B", "B", ""]], [3, -1, 0, null], [0, 0, 1, ["A", "A", ""]]]],
  ["123\ud83d\ude00\u0301", [[0, -1, 0, null], [0, -1, 0, null]]],
];
function advance<T extends RegExp>(expression: T, text: string): RegExpExecArray | null { return expression.exec(text); }
function inspect(expression: RegExp, sample: UnicodeSample): void {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; expression.lastIndex = sample[1][0][0]; same(expression.flags, "gu");
  for (const wanted of sample[1]) {
    const before = expression.lastIndex, match = advance(expression, text); observe(match, before, expression.lastIndex, text, wanted, log, expected);
  }
  assert.compareArray(log, expected);
}
for (const sample of samples) {
  const literal = /(?<letters>\p{L}+)(\p{M}*)/gu; for (const expression of [literal, new RegExp(literal.source, literal.flags)]) { inspect(expression, sample); same(expression.lastIndex, sample[1][sample[1].length - 1][2]); }
}
