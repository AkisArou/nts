/*---
description: "Control for unicode-v-field-sticky-surrogate-start; A sticky UnicodeSets matcher stored in an interface field rounds an interior surrogate start to its code-point boundary."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-narrowing]
---*/
// A vy matcher crosses a typed field with explicit initial lastIndex values; node may return the containing surrogate pair before that index, then retains exact sticky state. The control calls fresh literals with independent expected starting positions.
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
  ["\ud83d\ude00Zx", [[1, 0, 3, ["\ud83d\ude00Z", "\ud83d\ude00", "Z", ""]], [3, 3, 4, ["x", "x", undefined, ""]], [4, -1, 0, null], [0, 0, 3, ["\ud83d\ude00Z", "\ud83d\ude00", "Z", ""]]]],
  ["A\ud83d\ude00BZ", [[2, 1, 3, ["\ud83d\ude00", "\ud83d\ude00", undefined, ""]], [3, 3, 5, ["BZ", "B", "Z", ""]], [5, -1, 0, null], [0, 0, 1, ["A", "A", undefined, ""]]]],
  ["\ud83dQ", [[0, 0, 1, ["\ud83d", "\ud83d", undefined, ""]], [1, 1, 2, ["Q", "Q", undefined, ""]], [2, -1, 0, null], [0, 0, 1, ["\ud83d", "\ud83d", undefined, ""]]]],
  ["\ude00Q", [[0, 0, 1, ["\ude00", "\ude00", undefined, ""]], [1, 1, 2, ["Q", "Q", undefined, ""]], [2, -1, 0, null], [0, 0, 1, ["\ude00", "\ude00", undefined, ""]]]],
  ["a\u0301B", [[1, 1, 2, ["\u0301", "\u0301", undefined, ""]], [2, 2, 3, ["B", "B", undefined, ""]], [3, -1, 0, null], [0, 0, 1, ["a", "a", undefined, ""]]]],
  ["\nA", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["\r\nZ", [[1, -1, 0, null], [0, -1, 0, null]]],
  ["\u2028Z", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["\ud83d\ude00", [[3, -1, 0, null], [0, 0, 2, ["\ud83d\ude00", "\ud83d\ude00", undefined, ""]]]],
];
function inspect(sample: UnicodeSample): number {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; let final = 0;
  for (const wanted of sample[1]) {
    const expression = /(.)(Z)?()/vy; expression.lastIndex = wanted[0]; same(expression.flags, "vy");
    const before = expression.lastIndex, match = expression.exec(text); final = expression.lastIndex; observe(match, before, final, text, wanted, log, expected);
  }
  assert.compareArray(log, expected); return final;
}
for (const sample of samples) for (const round of [0, 1]) same(inspect(sample), sample[1][sample[1].length - 1][2]);
