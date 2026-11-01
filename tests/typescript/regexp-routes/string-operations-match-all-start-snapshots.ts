/*---
description: "Two returned matchAll iterators retain distinct start snapshots while their original RegExp is shared and rewritten."
features: [ts-regexp-routes, ts-regexp-route-string-operations, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-interfaces, ts-generics, ts-generic-constraints, ts-type-aliases, ts-tuples, ts-unions, ts-null-undefined]
---*/
// An iterator returned through a typed interface starts at the creation index; node interleaves it with a second iterator from zero, preserving distinct result arrays and leaving the second partly consumed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let at = 0; at < expected.length; at++) same(actual[at], expected[at]); }
type MatchRow = [number, string, string, string | undefined];
type Row = { input: string; start: number; matches: (MatchRow | null)[] };
const rows: Row[] = [
  { input: "", start: 1, matches: [null, null, null] },
  { input: "ababa", start: 2, matches: [[2, "ab", "a", "b"], [0, "ab", "a", "b"], [4, "a", "a", undefined]] },
  { input: "\ud83d\ude00a", start: 2, matches: [[2, "a", "a", undefined], [2, "a", "a", undefined], null] },
  { input: "e\u0301ab", start: 2, matches: [[2, "ab", "a", "b"], [2, "ab", "a", "b"], null] },
  { input: "\na", start: 2, matches: [null, [1, "a", "a", undefined], null] },
  { input: "\r\nab", start: 3, matches: [null, [2, "ab", "a", "b"], null] },
  { input: "\u2028a", start: 1, matches: [[1, "a", "a", undefined], [1, "a", "a", undefined], null] },
  { input: "zzz", start: 1, matches: [null, null, null] }
];
interface MatchStream { next(): IteratorResult<RegExpMatchArray, undefined> }
interface PatternHolder { pattern: RegExp }
function sequence<T extends PatternHolder>(holder: T, input: string): MatchStream { return input.matchAll(holder.pattern); }
function inspect<T extends PatternHolder>(holder: T, row: Row): void {
  const expression = holder.pattern;
  const log: unknown[] = ["initial", expression.lastIndex], expected: unknown[] = ["initial", 0], retained: unknown[] = [];
  expression.lastIndex = row.start; same(expression.lastIndex, row.start); const held = sequence(holder, row.input); log.push("held", expression.lastIndex);
  expression.lastIndex = 0; same(expression.lastIndex, 0); const fresh = sequence(holder, row.input); log.push("fresh", expression.lastIndex);
  expected.push("held", row.start, "fresh", 0); const streams: MatchStream[] = [held, fresh, held];
  for (let at = 0; at < streams.length; at++) {
    const step = streams[at].next(); log.push("next", at, expression.lastIndex, step.done);
    if (step.done) log.push(step.value); else { const hit = step.value, groups = hit.groups; if (groups === undefined) throw new Error("missing groups"); same(hit.length, 3); exact(Object.keys(groups), ["word"]); log.push(hit.index, hit[0], hit[1], hit[2], hit.input, groups.word); retained.push(hit); }
    const wanted = row.matches[at]; expected.push("next", at, 0, wanted === null);
    if (wanted === null) expected.push(undefined); else expected.push(wanted[0], wanted[1], wanted[2], wanted[3], row.input, wanted[2]);
  }
  for (let left = 0; left < retained.length; left++) for (let right = left + 1; right < retained.length; right++) same(Object.is(retained[left], retained[right]), false); same(expression.lastIndex, 0); exact(log, expected);
}
for (const row of rows) {
  const literal = /(?<word>a)(b)?/g; for (const pattern of [literal, new RegExp(literal.source, literal.flags)]) inspect({ pattern }, row);
}
