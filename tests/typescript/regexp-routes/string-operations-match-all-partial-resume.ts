/*---
description: "A matchAll iterator stored behind an interface resumes from its clone after the original RegExp state changes."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-interfaces, ts-generics, ts-generic-constraints, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined]
---*/
// After the first typed next call the original lastIndex becomes 99; node yields every remaining capture from the iterator and leaves the original state unchanged.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type MatchRow = [number, string, string | undefined, string];
type Row = { input: string; matches: MatchRow[] };
const rows: Row[] = [
  { input: "", matches: [] },
  { input: "abc c ac", matches: [[0, "abc", "a", "b"], [4, "c", undefined, ""], [6, "ac", "a", ""]] },
  { input: "\ud83d\ude00c", matches: [[2, "c", undefined, ""]] },
  { input: "e\u0301ac", matches: [[2, "ac", "a", ""]] },
  { input: "\nc", matches: [[1, "c", undefined, ""]] },
  { input: "\r\nbc", matches: [[2, "bc", undefined, "b"]] },
  { input: "\u2028c", matches: [[1, "c", undefined, ""]] },
  { input: "zzz", matches: [] }
];
interface MatchStream { next(): IteratorResult<RegExpMatchArray, undefined> }
interface PatternHolder { pattern: RegExp }
function inspect<T extends PatternHolder>(holder: T, row: Row): void {
  const expression = holder.pattern;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0]; expression.lastIndex = 0; same(expression.lastIndex, 0);
  const holderStream: { stream: MatchStream } = { stream: row.input.matchAll(expression) }; log.push("matchAll", expression.lastIndex); expected.push("matchAll", 0);
  for (let at = 0; at < row.matches.length + 2; at++) {
    const step = holderStream.stream.next(); log.push("next", at, expression.lastIndex, step.done);
    if (step.done) log.push(step.value); else { const hit = step.value, groups = hit.groups; if (groups === undefined) throw new Error("missing groups"); same(hit.length, 3); exact(Object.keys(groups), ["letter"]); log.push(hit.index, hit[0], hit[1], hit[2], hit.input, groups.letter); }
    expected.push("next", at, at === 0 ? 0 : 99, at >= row.matches.length);
    if (at >= row.matches.length) expected.push(undefined); else { const item = row.matches[at]; expected.push(item[0], item[1], item[2], item[3], row.input, item[2]); }
    if (at === 0) { expression.lastIndex = 99; log.push("pause", expression.lastIndex); expected.push("pause", 99); }
  }
  same(expression.lastIndex, 99); exact(log, expected);
}
for (const row of rows) {
  const literal = /(?<letter>a)?(b*)c/g; for (const pattern of [literal, new RegExp(literal.source, literal.flags)]) inspect({ pattern }, row);
}
