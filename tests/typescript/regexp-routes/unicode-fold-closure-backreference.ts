/*---
description: "A closure retains a case-insensitive Unicode matcher and its named backreference state across fold-equivalent inputs."
features: [ts-regexp-routes, ts-regexp-route-unicode, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-objects, ts-closures, ts-function-types, ts-arrow-functions, ts-narrowing]
---*/
// A typed closure calls the same iu or iv matcher repeatedly; node retains original captures for long s and Kelvin, rejects dotless-i folding, and preserves reset and restart positions.
type UnicodeStep = [number, number, number, (string | undefined)[] | null];
type UnicodeSample = [string, UnicodeStep[]];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function observe(match: RegExpExecArray | null, before: number, after: number, text: string, wanted: UnicodeStep, log: unknown[], expected: unknown[]): void {
  same(before, wanted[0]); same(after, wanted[2]); log.push("exec", before, after); expected.push("exec", wanted[0], wanted[2]);
  const captures = wanted[3]; if (match === null) { same(captures, null); log.push(null); expected.push(null); return; } if (captures === null) throw new Error("unexpected match");
  same(match.index, wanted[1]); same(match.input, text); same(match.length, captures.length); log.push(match.index, match.input, match.length); expected.push(wanted[1], text, captures.length);
  for (let at = 0; at < captures.length; at++) { const value: string | undefined = match[at]; same(value, captures[at]); log.push(value); expected.push(captures[at]); }
  const groups = match.groups; if (groups === undefined) throw new Error("missing named group"); assert.compareArray(Object.keys(groups), ["fold"]); same(groups.fold, captures[1]); log.push("group", "fold", groups.fold); expected.push("group", "fold", captures[1]);
}
const samples: UnicodeSample[] = [
  ["", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["sS Kk iI", [[0, 0, 2, ["sS", "s", ""]], [2, 3, 5, ["Kk", "K", ""]], [5, 6, 8, ["iI", "i", ""]], [8, -1, 0, null], [0, 0, 2, ["sS", "s", ""]]]],
  ["\u017fS \u212ak \u0131I iI", [[0, 0, 2, ["\u017fS", "\u017f", ""]], [2, 3, 5, ["\u212ak", "\u212a", ""]], [5, 9, 11, ["iI", "i", ""]], [11, -1, 0, null], [0, 0, 2, ["\u017fS", "\u017f", ""]]]],
  ["\ud83d\ude00\u017fs\u212aK", [[0, 2, 4, ["\u017fs", "\u017f", ""]], [4, 4, 6, ["\u212aK", "\u212a", ""]], [6, -1, 0, null], [0, 2, 4, ["\u017fs", "\u017f", ""]]]],
  ["s\u0301s \u212aK", [[0, 4, 6, ["\u212aK", "\u212a", ""]], [6, -1, 0, null], [0, 4, 6, ["\u212aK", "\u212a", ""]]]],
  ["\u017fS\n\u212aK", [[0, 0, 2, ["\u017fS", "\u017f", ""]], [2, 3, 5, ["\u212aK", "\u212a", ""]], [5, -1, 0, null], [0, 0, 2, ["\u017fS", "\u017f", ""]]]],
  ["sS\r\nI\u0131", [[0, 0, 2, ["sS", "s", ""]], [2, -1, 0, null], [0, 0, 2, ["sS", "s", ""]]]],
  ["\u2028iI", [[0, 1, 3, ["iI", "i", ""]], [3, -1, 0, null], [0, 1, 3, ["iI", "i", ""]]]],
  ["\u0131I \u0130i \u00dfs", [[0, -1, 0, null], [0, -1, 0, null]]],
  ["\ud83d\u017fS", [[0, 1, 3, ["\u017fS", "\u017f", ""]], [3, -1, 0, null], [0, 1, 3, ["\u017fS", "\u017f", ""]]]],
];
function inspect(expression: RegExp, sample: UnicodeSample, flags: string): void {
  const text = sample[0], log: unknown[] = [], expected: unknown[] = []; expression.lastIndex = sample[1][0][0]; same(expression.flags, flags);
  const next: (text: string) => RegExpExecArray | null = input => expression.exec(input);
  for (const wanted of sample[1]) {
    const before = expression.lastIndex, match = next(text); observe(match, before, expression.lastIndex, text, wanted, log, expected);
  }
  assert.compareArray(log, expected);
}
for (const sample of samples) for (const flags of ["giu", "giv"]) {
  const literal = flags === "giu" ? /(?<fold>[ski])\k<fold>()/giu : /(?<fold>[ski])\k<fold>()/giv; for (const expression of [literal, new RegExp(literal.source, literal.flags)]) { inspect(expression, sample, flags); same(expression.lastIndex, sample[1][sample[1].length - 1][2]); }
}
