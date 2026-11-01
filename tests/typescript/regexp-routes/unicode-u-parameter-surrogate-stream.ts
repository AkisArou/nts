/*---
description: "A RegExp parameter preserves Unicode code-point captures and code-unit lastIndex across success, failure and restart."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-narrowing]
---*/
// A global u matcher crosses a RegExp parameter; node consumes surrogate pairs once, preserves optional versus empty captures and restarts from zero after failure.
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
  ["AZB", [[0, 0, 2, ["AZ", "A", "Z", ""]], [2, 2, 3, ["B", "B", undefined, ""]], [3, -1, 0, null], [0, 0, 2, ["AZ", "A", "Z", ""]]]],
  ["\ud83d\ude00Zx", [[0, 0, 3, ["\ud83d\ude00Z", "\ud83d\ude00", "Z", ""]], [3, 3, 4, ["x", "x", undefined, ""]], [4, -1, 0, null], [0, 0, 3, ["\ud83d\ude00Z", "\ud83d\ude00", "Z", ""]]]],
  ["\ud83dZ", [[0, 0, 2, ["\ud83dZ", "\ud83d", "Z", ""]], [2, -1, 0, null], [0, 0, 2, ["\ud83dZ", "\ud83d", "Z", ""]]]],
  ["\ude00Q", [[0, 0, 1, ["\ude00", "\ude00", undefined, ""]], [1, 1, 2, ["Q", "Q", undefined, ""]], [2, -1, 0, null], [0, 0, 1, ["\ude00", "\ude00", undefined, ""]]]],
  ["a\u0301\nB", [[0, 0, 1, ["a", "a", undefined, ""]], [1, 1, 2, ["\u0301", "\u0301", undefined, ""]], [2, 3, 4, ["B", "B", undefined, ""]], [4, -1, 0, null], [0, 0, 1, ["a", "a", undefined, ""]]]],
  ["\r\nZ", [[0, 2, 3, ["Z", "Z", undefined, ""]], [3, -1, 0, null], [0, 2, 3, ["Z", "Z", undefined, ""]]]],
  ["\u2028Z", [[0, 1, 2, ["Z", "Z", undefined, ""]], [2, -1, 0, null], [0, 1, 2, ["Z", "Z", undefined, ""]]]],
  ["\n\r\n\u2028", [[0, -1, 0, null], [0, -1, 0, null]]],
];
function inspect(expression: RegExp, sample: UnicodeSample): void {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; expression.lastIndex = sample[1][0][0]; same(expression.flags, "gu");
  for (const wanted of sample[1]) {
    const before = expression.lastIndex, match = expression.exec(text); observe(match, before, expression.lastIndex, text, wanted, log, expected);
  }
  assert.compareArray(log, expected);
}
for (const sample of samples) {
  const literal = /(.)(Z)?()/gu; for (const expression of [literal, new RegExp(literal.source, literal.flags)]) { inspect(expression, sample); same(expression.lastIndex, sample[1][sample[1].length - 1][2]); }
}
