/*---
description: "A generic holder preserves a UnicodeSets intersection matcher and its captures while excluding Greek nonletters."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-generics, ts-narrowing]
---*/
// A RegExp passes through a generic holder before v intersection calls; node returns only Greek Letters, leaves excluded Greek marks between matches and resets the shared cursor on failure.
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
  ["AZ", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["\u03b1\u1fbf\u03b2", [[0, 0, 1, ["\u03b1", "\u03b1", ""]], [1, 2, 3, ["\u03b2", "\u03b2", ""]], [3, -1, 0, null], [0, 0, 1, ["\u03b1", "\u03b1", ""]]]],
  ["\ud83d\ude00\u0391Z\u03a9", [[0, 2, 3, ["\u0391", "\u0391", ""]], [3, 4, 5, ["\u03a9", "\u03a9", ""]], [5, -1, 0, null], [0, 2, 3, ["\u0391", "\u0391", ""]]]],
  ["\ud83d\u03a3\ude00\u03b2", [[0, 1, 2, ["\u03a3", "\u03a3", ""]], [2, 3, 4, ["\u03b2", "\u03b2", ""]], [4, -1, 0, null], [0, 1, 2, ["\u03a3", "\u03a3", ""]]]],
  ["\u03b1\u0301\u03b2", [[0, 0, 1, ["\u03b1", "\u03b1", ""]], [1, 2, 3, ["\u03b2", "\u03b2", ""]], [3, -1, 0, null], [0, 0, 1, ["\u03b1", "\u03b1", ""]]]],
  ["\u0391\n\u0392", [[0, 0, 1, ["\u0391", "\u0391", ""]], [1, 2, 3, ["\u0392", "\u0392", ""]], [3, -1, 0, null], [0, 0, 1, ["\u0391", "\u0391", ""]]]],
  ["\u0391\r\n\u0392", [[0, 0, 1, ["\u0391", "\u0391", ""]], [1, 3, 4, ["\u0392", "\u0392", ""]], [4, -1, 0, null], [0, 0, 1, ["\u0391", "\u0391", ""]]]],
  ["\u0391\u2028\u0392", [[0, 0, 1, ["\u0391", "\u0391", ""]], [1, 2, 3, ["\u0392", "\u0392", ""]], [3, -1, 0, null], [0, 0, 1, ["\u0391", "\u0391", ""]]]],
  ["\u1fbf\u0301\ud83d\ude00", [[0, -1, 0, null], [0, -1, 0, null]]],
];
function hold<T>(value: T): { current: T } { return { current: value }; }
function inspect(expression: RegExp, sample: UnicodeSample): void {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; expression.lastIndex = sample[1][0][0]; same(expression.flags, "gv");
  const box = hold(expression); same(box.current, expression);
  for (const wanted of sample[1]) {
    const before = box.current.lastIndex, match = box.current.exec(text); same(expression.lastIndex, wanted[2]); observe(match, before, box.current.lastIndex, text, wanted, log, expected);
  }
  assert.compareArray(log, expected);
}
for (const sample of samples) {
  const literal = /([\p{L}&&\p{Script=Greek}]+)()/gv; for (const expression of [literal, new RegExp(literal.source, literal.flags)]) { inspect(expression, sample); same(expression.lastIndex, sample[1][sample[1].length - 1][2]); }
}
