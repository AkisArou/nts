/*---
description: "Typed matcher and match-result fields retain Greek Script captures, optional marks and lastIndex across repeated calls."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-interfaces, ts-narrowing]
---*/
// An interface stores both a Greek-property matcher and its latest nullable result; node replaces success with null on failure and keeps optional undefined separate from an empty capture.
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
  ["ABC", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["\u03b1\u03b2\u0301 \u03b3", [[0, 0, 3, ["\u03b1\u03b2\u0301", "\u03b1\u03b2", "\u0301", ""]], [3, 4, 5, ["\u03b3", "\u03b3", undefined, ""]], [5, -1, 0, null], [0, 0, 3, ["\u03b1\u03b2\u0301", "\u03b1\u03b2", "\u0301", ""]]]],
  ["\ud83d\ude00\u03a3\u0301A\u03a9", [[0, 2, 4, ["\u03a3\u0301", "\u03a3", "\u0301", ""]], [4, 5, 6, ["\u03a9", "\u03a9", undefined, ""]], [6, -1, 0, null], [0, 2, 4, ["\u03a3\u0301", "\u03a3", "\u0301", ""]]]],
  ["\u03b1\u1fbf\u03b2", [[0, 0, 3, ["\u03b1\u1fbf\u03b2", "\u03b1\u1fbf\u03b2", undefined, ""]], [3, -1, 0, null], [0, 0, 3, ["\u03b1\u1fbf\u03b2", "\u03b1\u1fbf\u03b2", undefined, ""]]]],
  ["\ud83d\u03b1\ude00\u03b2", [[0, 1, 2, ["\u03b1", "\u03b1", undefined, ""]], [2, 3, 4, ["\u03b2", "\u03b2", undefined, ""]], [4, -1, 0, null], [0, 1, 2, ["\u03b1", "\u03b1", undefined, ""]]]],
  ["\u03b1\n\u03b2", [[0, 0, 1, ["\u03b1", "\u03b1", undefined, ""]], [1, 2, 3, ["\u03b2", "\u03b2", undefined, ""]], [3, -1, 0, null], [0, 0, 1, ["\u03b1", "\u03b1", undefined, ""]]]],
  ["\u03b1\r\n\u03b2", [[0, 0, 1, ["\u03b1", "\u03b1", undefined, ""]], [1, 3, 4, ["\u03b2", "\u03b2", undefined, ""]], [4, -1, 0, null], [0, 0, 1, ["\u03b1", "\u03b1", undefined, ""]]]],
  ["\u03b1\u2028\u03b2", [[0, 0, 1, ["\u03b1", "\u03b1", undefined, ""]], [1, 2, 3, ["\u03b2", "\u03b2", undefined, ""]], [3, -1, 0, null], [0, 0, 1, ["\u03b1", "\u03b1", undefined, ""]]]],
  ["\u0301\ud83d\ude00123", [[0, -1, 0, null], [0, -1, 0, null]]],
];
interface UnicodeSlot { pattern: RegExp; latest: RegExpExecArray | null }
function inspect(expression: RegExp, sample: UnicodeSample): void {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; expression.lastIndex = sample[1][0][0]; same(expression.flags, "gu");
  const slot: UnicodeSlot = { pattern: expression, latest: null }; same(slot.pattern, expression);
  for (const wanted of sample[1]) {
    const before = slot.pattern.lastIndex; slot.latest = slot.pattern.exec(text); same(expression.lastIndex, wanted[2]); observe(slot.latest, before, slot.pattern.lastIndex, text, wanted, log, expected);
  }
  assert.compareArray(log, expected);
}
for (const sample of samples) {
  const literal = /(\p{Script=Greek}+)(\u0301)?()/gu; for (const expression of [literal, new RegExp(literal.source, literal.flags)]) { inspect(expression, sample); same(expression.lastIndex, sample[1][sample[1].length - 1][2]); }
}
