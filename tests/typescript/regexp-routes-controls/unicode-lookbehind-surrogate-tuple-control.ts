/*---
description: "Control for unicode-lookbehind-surrogate-tuple; A typed tuple return preserves a Unicode lookbehind capture and the cursor following the consuming match."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-narrowing]
---*/
// A helper returns a nullable match and lastIndex together; node captures an entire preceding surrogate pair without consuming it and reports the following ASCII letter at its UTF-16 index. The control calls fresh literals with independent expected starting positions.
type UnicodeStep = [number, number, number, (string | undefined)[] | null];
type UnicodeSample = [string, UnicodeStep[]];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function observe(match: RegExpExecArray | null, before: number, after: number, text: string, wanted: UnicodeStep, log: unknown[], expected: unknown[]): void {
  same(before, wanted[0]); same(after, wanted[2]); log.push("exec", before, after); expected.push("exec", wanted[0], wanted[2]);
  const captures = wanted[3]; if (match === null) { same(captures, null); log.push(null); expected.push(null); return; } if (captures === null) throw new Error("unexpected match");
  same(match.index, wanted[1]); same(match.input, text); same(match.length, captures.length); log.push(match.index, match.input, match.length); expected.push(wanted[1], text, captures.length);
  for (let at = 0; at < captures.length; at++) { const value: string | undefined = match[at]; same(value, captures[at]); log.push(value); expected.push(captures[at]); }
  const groups = match.groups; if (groups === undefined) throw new Error("missing named group"); assert.compareArray(Object.keys(groups), ["prior"]); same(groups.prior, captures[1]); log.push("group", "prior", groups.prior); expected.push("group", "prior", captures[1]);
}
const samples: UnicodeSample[] = [
  ["", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["ABZ", [[0, 1, 2, ["B", "A", "B", ""]], [2, 2, 3, ["Z", "B", "Z", ""]], [3, -1, 0, null], [0, 1, 2, ["B", "A", "B", ""]]]],
  ["\ud83d\ude00AB", [[0, 2, 3, ["A", "\ud83d\ude00", "A", ""]], [3, 3, 4, ["B", "A", "B", ""]], [4, -1, 0, null], [0, 2, 3, ["A", "\ud83d\ude00", "A", ""]]]],
  ["A\ud83d\ude00Z", [[0, 3, 4, ["Z", "\ud83d\ude00", "Z", ""]], [4, -1, 0, null], [0, 3, 4, ["Z", "\ud83d\ude00", "Z", ""]]]],
  ["\ud83dA\ude00B", [[0, 1, 2, ["A", "\ud83d", "A", ""]], [2, 3, 4, ["B", "\ude00", "B", ""]], [4, -1, 0, null], [0, 1, 2, ["A", "\ud83d", "A", ""]]]],
  ["a\u0301B", [[0, 2, 3, ["B", "\u0301", "B", ""]], [3, -1, 0, null], [0, 2, 3, ["B", "\u0301", "B", ""]]]],
  ["\nA", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["A\r\nB", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["A\u2028B", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["xAZ", [[0, 1, 2, ["A", "x", "A", ""]], [2, 2, 3, ["Z", "A", "Z", ""]], [3, -1, 0, null], [0, 1, 2, ["A", "x", "A", ""]]]],
  ["\ud83d\ude00a", [[0, -1, 0, null], [0, -1, 0, null]]],
];
function inspect(sample: UnicodeSample): number {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; let final = 0;
  for (const wanted of sample[1]) {
    const expression = /(?<=(?<prior>.))([A-Z])()/gu; expression.lastIndex = wanted[0]; same(expression.flags, "gu");
    const before = expression.lastIndex, match = expression.exec(text); final = expression.lastIndex; observe(match, before, final, text, wanted, log, expected);
  }
  assert.compareArray(log, expected); return final;
}
for (const sample of samples) for (const round of [0, 1]) same(inspect(sample), sample[1][sample[1].length - 1][2]);
